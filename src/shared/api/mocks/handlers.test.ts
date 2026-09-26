import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { components as Proposed } from '../generated/proposed';
import type { components as Real } from '../generated/schema';
import { resetMockDb } from './node';

type ProjectResponse = Real['schemas']['ProjectResponse'];
type Explanation = Proposed['schemas']['Explanation'];
type ZonesFeatureCollection = Proposed['schemas']['ZonesFeatureCollection'];
type PlantingFeatureCollection = Proposed['schemas']['PlantingFeatureCollection'];

const IDS = {
  readyGeoreferenced: '5c0b7f2e9a3d4e61b8f0c2a7d9e4b1f3',
  readyLocal: '0e8d2b6a4c1f47e9a3b5d7c9e1f2a4b6',
  draft: '9a1c3e5b7d2f4a6c8e0b2d4f6a8c1e3b',
  processing: '3f7b1d9c5e2a4b8d6f0c3e5a7b9d1f2c',
  ambiguous: 'd1f3b5d7e9a14e2c4b6d8f0a2c4e6b8d',
};
const BBOX = [37.644, 55.758, 37.647, 55.76];

// Тип тела задаёт тест по контракту: runtime-проверки ответов нет, как и в продуктовом коде,
// а форму ответа проверяют ожидания самого теста.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- см. комментарий выше
const call = async <Body>(path: string, init?: RequestInit) => {
  const response = await fetch(`/api${path}`, init);
  const text = await response.text();
  return { response, body: (text === '' ? null : JSON.parse(text)) as Body };
};

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- см. call
const post = <Body>(path: string, body: unknown) =>
  call<Body>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const upload = (projectId: string, filename: string, bytes = 1024) =>
  call<ProjectResponse>(`/projects/${projectId}/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/zip',
      'X-Upload-Filename': encodeURIComponent(filename),
    },
    body: new Uint8Array(bytes),
  });

const getProject = async (projectId: string) =>
  (await call<ProjectResponse>(`/projects/${projectId}`)).body;

const advance = (ms: number) => {
  vi.setSystemTime(Date.now() + ms);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  resetMockDb();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('проекты', () => {
  test('начальные данные покрывают все статусы и все коды ошибок', async () => {
    const { body } = await call<ProjectResponse[]>('/projects');

    expect(new Set(body.map(({ status }) => status))).toEqual(
      new Set(['draft', 'parsing', 'zoning_layout', 'ready', 'failed']),
    );
    expect(new Set(body.map(({ job }) => job.error?.code).filter(Boolean))).toEqual(
      new Set([
        'bad_archive',
        'no_dxf_found',
        'ambiguous_root_dxf',
        'insufficient_geodetic_points',
        'georeference_service_error',
        'other',
      ]),
    );
    expect(body.find(({ id }) => id === IDS.ambiguous)?.job.error?.candidates).toHaveLength(3);
  });

  test('создание, изменение и удаление', async () => {
    const created = await post<ProjectResponse>('/projects', { name: 'Сквер', bbox_user: BBOX });
    expect(created.response.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Сквер', status: 'draft', job: { stage: 'draft' } });

    const updated = await call<ProjectResponse>(`/projects/${created.body.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Сквер на Покровке' }),
    });
    expect(updated.body.name).toBe('Сквер на Покровке');

    const deleted = await call(`/projects/${created.body.id}`, { method: 'DELETE' });
    expect(deleted.response.status).toBe(204);
    expect((await call(`/projects/${created.body.id}`)).response.status).toBe(404);
  });

  test('bbox_user необязателен, name обязателен', async () => {
    expect((await post('/projects', { name: 'Без привязки' })).response.status).toBe(201);

    const invalid = await post('/projects', { bbox_user: [1, 2] });
    expect(invalid.response.status).toBe(422);
    expect(invalid.body).toEqual({
      detail: [
        expect.objectContaining({ loc: ['body', 'name'], type: 'missing' }),
        expect.objectContaining({ loc: ['body', 'bbox_user'] }),
      ],
    });
  });

  test('неизвестный проект — 404 с detail-строкой', async () => {
    const { response, body } = await call('/projects/unknown');

    expect(response.status).toBe(404);
    expect(body).toEqual({ detail: 'Project not found' });
  });
});

describe('обработка', () => {
  const stagesDuring = async (projectId: string, seconds: number) => {
    const seen: string[] = [];
    for (let second = 0; second <= seconds; second += 0.5) {
      const { status, job } = await getProject(projectId);
      if (seen.at(-1) !== status) seen.push(status);
      expect(job.progress_pct).toBe(
        {
          queued: 0,
          extracting: 5,
          parsing: 10,
          georeferencing: 40,
          zoning_layout: 70,
          exporting: 90,
          ready: 100,
          failed: 100,
        }[status],
      );
      advance(500);
    }
    return seen;
  };

  test('проходит этапы бэкенда за 20 с и считает длительность без очереди', async () => {
    const { body: project } = await post<ProjectResponse>('/projects', {
      name: 'А',
      bbox_user: BBOX,
    });
    const accepted = await upload(project.id, 'site.zip');
    expect(accepted.response.status).toBe(202);
    expect(accepted.body.status).toBe('queued');

    expect(await stagesDuring(project.id, 21)).toEqual([
      'queued',
      'extracting',
      'parsing',
      'georeferencing',
      'zoning_layout',
      'exporting',
      'ready',
    ]);
    const { job } = await getProject(project.id);
    expect(Date.parse(job.finished_at ?? '') - Date.parse(job.started_at ?? '')).toBe(19_000);
    expect(job.georeference?.confidence).toBe('validated');
  });

  test('без bbox_user этап геопривязки пропускается', async () => {
    const { body: project } = await post<ProjectResponse>('/projects', { name: 'Б' });
    await upload(project.id, 'site.zip');

    const stages = await stagesDuring(project.id, 17);
    expect(stages).not.toContain('georeferencing');
    expect(stages.at(-1)).toBe('ready');
  });

  test.each([
    ['ambiguous', 'ambiguous_root_dxf'],
    ['nodxf', 'no_dxf_found'],
  ])('имя файла с «%s» завершается ошибкой %s', async (marker, code) => {
    await upload(IDS.draft, `site_${marker}.zip`);
    advance(20_000);

    const { status, job } = await getProject(IDS.draft);
    expect(status).toBe('failed');
    expect(job.error?.code).toBe(code);
  });

  test('имя файла с «busy» — 429', async () => {
    expect((await upload(IDS.draft, 'busy.zip')).response.status).toBe(429);
    expect((await getProject(IDS.draft)).status).toBe('draft');
  });

  test('больше двух обработок одновременно — 429', async () => {
    const ids = await Promise.all(
      ['1', '2', '3'].map(
        async (name) => (await post<ProjectResponse>('/projects', { name })).body.id,
      ),
    );
    const [first = '', second = '', third = ''] = ids;

    expect((await upload(first, 'a.zip')).response.status).toBe(202);
    expect((await upload(second, 'b.zip')).response.status).toBe(202);
    expect((await upload(third, 'c.zip')).response.status).toBe(429);
    advance(20_000);
    expect((await upload(third, 'c.zip')).response.status).toBe(202);
  });

  test('загрузка в идущую обработку — 409', async () => {
    const { response, body } = await upload(IDS.processing, 'site.zip');

    expect(response.status).toBe(409);
    expect(body).toEqual({ detail: "Project is not uploadable in status 'parsing'" });
  });
});

describe('повторная обработка', () => {
  test('ambiguous_root_dxf снимается выбором главного DXF из кандидатов', async () => {
    const rejected = await post(`/projects/${IDS.ambiguous}/runs`, { root_dxf: 'Другой.dxf' });
    expect(rejected.response.status).toBe(422);

    const accepted = await post<ProjectResponse>(`/projects/${IDS.ambiguous}/runs`, {
      root_dxf: 'ГП/Генплан.dxf',
    });
    expect(accepted.response.status).toBe(202);
    expect(accepted.body.status).toBe('queued');
    advance(20_000);
    expect((await getProject(IDS.ambiguous)).status).toBe('ready');
  });

  test('без выбора главного DXF ошибка повторяется', async () => {
    await post(`/projects/${IDS.ambiguous}/runs`, {});
    advance(20_000);

    expect((await getProject(IDS.ambiguous)).job.error?.code).toBe('ambiguous_root_dxf');
  });

  test.each([
    ['архив не загружен', IDS.draft, 'No archive uploaded for this project'],
    ['обработка идёт', IDS.processing, "Project is not runnable in status 'parsing'"],
  ])('%s — 409', async (_, projectId, detail) => {
    const { response, body } = await post(`/projects/${projectId}/runs`, {});

    expect(response.status).toBe(409);
    expect(body).toEqual({ detail });
  });

  test.each([
    [
      'шаг вне диапазона',
      { planting_rules: { TREE_ROW_CURB: { spacing_m: 100 } } },
      ['body', 'planting_rules', 'TREE_ROW_CURB', 'spacing_m'],
    ],
    [
      'неизвестное правило',
      { planting_rules: { PALM_ROW: {} } },
      ['body', 'planting_rules', 'PALM_ROW'],
    ],
    [
      'отступ у правила заполнения',
      { planting_rules: { TREE_FILL_LAWN: { offset_m: 1 } } },
      ['body', 'planting_rules', 'TREE_FILL_LAWN', 'offset_m'],
    ],
    ['пустой список типов', { plant_types: [] }, ['body', 'plant_types']],
  ])('%s — 422', async (_, request, loc) => {
    const { response, body } = await post(`/projects/${IDS.readyGeoreferenced}/runs`, request);

    expect(response.status).toBe(422);
    expect(body).toEqual({ detail: [expect.objectContaining({ loc })] });
  });

  test('параметры меняют результат', async () => {
    const before = await call<Explanation>(`/projects/${IDS.readyGeoreferenced}/explanation`);
    await post(`/projects/${IDS.readyGeoreferenced}/runs`, {
      plant_types: ['tree'],
      planting_rules: { TREE_ROW_CURB: { spacing_m: 4 } },
    });
    advance(20_000);
    const after = await call<Explanation>(`/projects/${IDS.readyGeoreferenced}/explanation`);

    expect(after.body.plantings.every(({ plant_type }) => plant_type === 'tree')).toBe(true);
    const rowCount = (explanation: Explanation) =>
      explanation.plantings.filter(({ rule }) => rule.id === 'TREE_ROW_CURB').length;
    expect(rowCount(after.body)).toBeGreaterThan(rowCount(before.body));
  });
});

describe('результат', () => {
  test('каждая посадка проходит все проверки, каждое отклонённое место — нет', async () => {
    const { body } = await call<Explanation>(`/projects/${IDS.readyGeoreferenced}/explanation`);

    expect(body.plantings.length).toBeGreaterThanOrEqual(20);
    expect(body.plantings.length).toBeLessThanOrEqual(40);
    expect(body.rejected.length).toBeGreaterThan(0);
    for (const { checks } of body.plantings) {
      expect(checks.length).toBeGreaterThan(0);
      for (const check of checks) expect(check.actual_m).toBeGreaterThanOrEqual(check.required_m);
    }
    for (const { failed_checks } of body.rejected) {
      expect(failed_checks.length).toBeGreaterThan(0);
      for (const check of failed_checks) expect(check.actual_m).toBeLessThan(check.required_m);
    }
  });

  test('нормы из справочника, пунктов нет', async () => {
    const { body } = await call<Explanation>(`/projects/${IDS.readyGeoreferenced}/explanation`);

    const normIds = body.plantings.flatMap(({ checks }) => checks.map(({ norm_id }) => norm_id));
    expect(normIds.every((id) => id in body.norms)).toBe(true);
    expect(Object.values(body.norms).every(({ clause }) => clause === null)).toBe(true);
    expect(body.norms['743-pp-gas']?.text).toContain('газопровод');
  });

  test('посадки в /planting и /explanation совпадают по id', async () => {
    const explanation = await call<Explanation>(`/projects/${IDS.readyGeoreferenced}/explanation`);
    const planting = await call<PlantingFeatureCollection>(
      `/projects/${IDS.readyGeoreferenced}/planting`,
    );

    expect(planting.body.features.map(({ properties }) => properties.id)).toEqual(
      explanation.body.plantings.map(({ id }) => id),
    );
  });

  test('без геопривязки координаты локальные', async () => {
    const explanation = await call<Explanation>(`/projects/${IDS.readyLocal}/explanation`);
    const zones = await call<ZonesFeatureCollection>(`/projects/${IDS.readyLocal}/zones`);

    expect(explanation.body.plantings[0]?.position).toMatchObject({ lon: null, lat: null });
    expect(zones.body.metadata.crs).toBe('local drawing coordinates, no geo-reference available');
  });

  test('зоны запрета построены по нормам для каждого типа посадки', async () => {
    const { response, body } = await call<ZonesFeatureCollection>(
      `/projects/${IDS.readyGeoreferenced}/zones`,
    );

    expect(response.headers.get('Content-Type')).toBe('application/geo+json');
    const gasZones = body.features
      .map(({ properties }) => properties)
      .filter((properties) => properties.zone_type === 'prohibited')
      .filter(({ obstacle_subtype }) => obstacle_subtype === 'gas');
    expect(gasZones.map(({ plant_type, distance_m }) => [plant_type, distance_m])).toEqual([
      ['tree', 1.5],
      ['shrub', 1.5],
    ]);
  });

  test('DXF с заголовками файла', async () => {
    const response = await fetch(`/api/projects/${IDS.readyGeoreferenced}/dxf`);

    expect(response.headers.get('Content-Type')).toBe('application/dxf');
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="planting.dxf"; filename*=UTF-8''${encodeURIComponent('Сквер на Покровке')}.dxf`,
    );
    const dxf = await response.text();
    expect(dxf.startsWith('0\r\nSECTION')).toBe(true);
    expect(dxf).toContain('GREENING_PROPOSED');
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
  });

  test.each(['explanation', 'zones', 'planting', 'dxf'])(
    '/%s до готовности — 404 с текущим статусом',
    async (resource) => {
      const { response, body } = await call(`/projects/${IDS.draft}/${resource}`);

      expect(response.status).toBe(404);
      expect(body).toEqual({ detail: 'Project data not available yet (status: draft)' });
    },
  );

  test('параметры по умолчанию — из layout/default.yaml бэкенда', async () => {
    const { body } = await call<Proposed['schemas']['ProcessingDefaults']>('/processing-defaults');

    expect(
      Object.entries(body.planting_rules).map(([id, rule]) => [
        id,
        rule.spacing_m.default,
        rule.offset_m?.default ?? null,
      ]),
    ).toEqual([
      ['TREE_ROW_CURB', 6, 2.2],
      ['TREE_FILL_LAWN', 5, null],
      ['SHRUB_HEDGE_CURB', 1.5, 0.8],
      ['SHRUB_FILL_LAWN', 3, null],
    ]);
  });
});

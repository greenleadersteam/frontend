import { beforeEach, describe, expect, test, vi } from 'vitest';

import { placementTransform } from '@/shared/lib/georeference';

import type { components as Proposed } from '../generated/proposed';
import type { components as Real } from '../generated/schema';
import { resetMockDb } from './node';

type Schemas = Proposed['schemas'];
type ProjectResponse = Real['schemas']['ProjectResponse'];

const READY_GEO = '5c0b7f2e9a3d4e61b8f0c2a7d9e4b1f3';
// «Шаболовка»: без геопривязки, координаты — метры чертежа.
const READY_LOCAL = '0e8d2b6a4c1f47e9a3b5d7c9e1f2a4b6';

// Тип тела задаёт тест по контракту: runtime-проверки ответов нет, как и в продуктовом коде.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- см. комментарий выше
const call = async <Body>(path: string, init?: RequestInit) => {
  const response = await fetch(`/api${path}`, init);
  const text = await response.text();
  return { response, body: (text === '' ? null : JSON.parse(text)) as Body };
};

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- см. call
const put = <Body>(path: string, body: unknown) =>
  call<Body>(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- см. call
const post = <Body>(path: string, body: unknown) =>
  call<Body>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  resetMockDb();
});

describe('нормы и породы', () => {
  test('/norms — запись на пару «объект + тип посадки»; пункт — только подтверждённый для типа', async () => {
    const { body } = await call<Schemas['Norm'][]>('/norms');

    expect(new Set(body.map(({ id }) => id)).size).toBe(body.length);
    expect(body.filter(({ plant_type }) => plant_type === 'tree')).toHaveLength(body.length / 2);
    expect(
      body
        .filter(({ clause }) => clause !== null)
        .map(({ id }) => id)
        .sort(),
    ).toEqual([
      '743-pp-building-shrub',
      '743-pp-building-tree',
      '743-pp-comm-cable-shrub',
      '743-pp-comm-cable-tree',
      '743-pp-drainage-tree',
      '743-pp-footpath-edge-shrub',
      '743-pp-footpath-edge-tree',
      '743-pp-gas-tree',
      '743-pp-heat-shrub',
      '743-pp-heat-tree',
      '743-pp-poles-tree',
      '743-pp-power-cable-shrub',
      '743-pp-power-cable-tree',
      '743-pp-retaining-wall-shrub',
      '743-pp-retaining-wall-tree',
      '743-pp-road-edge-shrub',
      '743-pp-road-edge-tree',
      '743-pp-school-shrub',
      '743-pp-school-tree',
      '743-pp-sewer-tree',
      '743-pp-slope-shrub',
      '743-pp-slope-tree',
      '743-pp-water-tree',
    ]);
    // В таблице у кустарника прочерк: значение сервиса показывается без пункта.
    expect(body.find(({ id }) => id === '743-pp-gas-shrub')).toMatchObject({
      distance_m: 1.5,
      clause: null,
    });
    for (const norm of body.filter(({ act }) => act !== null)) {
      expect(norm.source_url).toBe(
        'https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/',
      );
    }
  });

  test('/species — справочник на 12–20 пород с источником у каждой', async () => {
    const { body } = await call<Schemas['Species'][]>('/species');

    expect(body.length).toBeGreaterThanOrEqual(12);
    expect(body.length).toBeLessThanOrEqual(20);
    expect(body.every(({ source }) => source.includes('623-ПП'))).toBe(true);
  });

  test('у каждой посадки порода из справочника и причина по проверенному правилу', async () => {
    const species = (await call<Schemas['Species'][]>('/species')).body;
    const { body } = await call<Schemas['PlantingFeatureCollection']>(
      `/projects/${READY_GEO}/planting`,
    );

    for (const { properties } of body.features) {
      const chosen = species.find(({ id }) => id === properties.species_id);
      expect(chosen?.plant_type).toBe(properties.plant_type);
      expect(properties.species_reason_ru).toMatch(
        /^(Крона около [\d,]+\u00A0м — вписывается в шаг .+ [\d,]+\u00A0м|Вид из ассортимента для внутриквартальных посадок \(623-ПП, табл\. В\.6\))$/,
      );
    }
    // Дуб — «+ с огр.» в табл. В.6: автоматически не назначается.
    expect(body.features.some(({ properties }) => properties.species_id === 'quercus_robur')).toBe(
      false,
    );
  });
});

describe('обоснование', () => {
  test('checks в /explanation — расстояния по геометрии препятствий, все нормы соблюдены', async () => {
    const norms = (await call<Schemas['Norm'][]>('/norms')).body;
    const { body } = await call<Schemas['ExplanationEntry'][]>(
      `/projects/${READY_LOCAL}/explanation`,
    );
    const first = body.find(({ id }) => id === 'TREE_ROW_CURB-00001');

    // Дерево в (3; 2,2): кабель на y = 4,5, борт на y = 0, газ на y = 12.
    expect(first?.checks?.find(({ subtype }) => subtype === 'power_cable')).toMatchObject({
      required_m: 2,
      actual_m: 2.3,
      norm_id: '743-pp-power-cable-tree',
    });
    expect(first?.checks?.find(({ category }) => category === 'road_edge')?.actual_m).toBe(2.2);
    for (const entry of body) {
      for (const check of entry.checks ?? []) {
        expect(check.actual_m).toBeGreaterThanOrEqual(check.required_m);
        // Ссылка — на запись для типа этой посадки.
        expect(norms.find(({ id }) => id === check.norm_id)?.plant_type).toBe(entry.plant_type);
      }
    }
  });

  test('/obstacles — сети, здания, борт и тротуар, граница работ, без путей сервера', async () => {
    const { body } = await call<Schemas['ObstaclesFeatureCollection']>(
      `/projects/${READY_LOCAL}/obstacles`,
    );

    expect(new Set(body.features.map(({ properties }) => properties.category))).toEqual(
      new Set([
        'road_edge',
        'underground_utilities',
        'green_existing',
        'buildings',
        'footpath_edge',
        'wells_hatches',
        'site_boundary',
      ]),
    );
    const text = JSON.stringify(body);
    expect(text).not.toContain('source_file');
    expect(text).not.toContain('source_folder');
    expect(body.metadata.crs).toBe('local drawing coordinates, no geo-reference available');
  });

  // Разобранная подоснова есть и у проекта, упавшего на геопривязке: по границе работ из неё
  // модуль геопривязки строит контур.
  test('/obstacles упавшего на геопривязке — объекты в метрах чертежа; у упавшего раньше — 404', async () => {
    vi.setSystemTime(Date.now() + 60_000);
    // «Улица Бахрушина, 11»: insufficient_geodetic_points.
    const { response, body } = await call<Schemas['ObstaclesFeatureCollection']>(
      '/projects/e5b7d9f1a3c54f6e8a0c2e4b6d8f1a3c/obstacles',
    );
    expect(response.status).toBe(200);
    expect(body.metadata.crs).toBe('local drawing coordinates, no geo-reference available');
    const boundary = body.features.find(
      ({ properties }) => properties.category === 'site_boundary',
    );
    expect(boundary?.geometry).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [0, -3],
          [60, -3],
          [60, 20],
          [0, 20],
          [0, -3],
        ],
      ],
    });

    // «Улица Большая Ордынка, 21»: архив повреждён, до разбора дело не дошло.
    const broken = await call('/projects/b4e6a8c0d2f44b7e9a1c3e5b7d9f0a2c/obstacles');
    expect(broken.response.status).toBe(404);
  });

  test('/rejected — 5–15 мест, у каждого непройденная проверка', async () => {
    const { body } = await call<Schemas['RejectedSitesFeatureCollection']>(
      `/projects/${READY_GEO}/rejected`,
    );

    expect(body.features.length).toBeGreaterThanOrEqual(5);
    expect(body.features.length).toBeLessThanOrEqual(15);
    for (const { properties } of body.features) {
      expect(properties.failed_checks.length).toBeGreaterThan(0);
      for (const check of properties.failed_checks) {
        expect(check.actual_m).toBeLessThan(check.required_m);
      }
    }
  });
});

describe('версии плана посадок', () => {
  const versionUrl = (version: number | string) =>
    `/projects/${READY_LOCAL}/plantings/${String(version)}`;
  const versionOf = async (version: number) =>
    (await call<Schemas['PlantingVersionFeatureCollection']>(versionUrl(version))).body;
  const editOf = (version: number, edit: Partial<Schemas['PlantingEdit']>) =>
    post<Schemas['PlantingVersionCreated']>(`${versionUrl(version)}/edit`, {
      add: [],
      update: [],
      delete: [],
      ...edit,
    });

  test('до правок — одна версия: расстановка обработки, она же в /planting', async () => {
    const { body } = await call<Schemas['PlantingVersion'][]>(`/projects/${READY_LOCAL}/plantings`);
    const service = await versionOf(1);
    const planting = await call<Schemas['PlantingFeatureCollection']>(
      `/projects/${READY_LOCAL}/planting`,
    );

    expect(body).toEqual([
      expect.objectContaining({
        id: 1,
        kind: 'auto',
        name: null,
        based_on: null,
        planting_count: service.features.length,
      }),
    ]);
    expect(service.metadata.version).toBe(1);
    expect(service.features.every(({ properties }) => properties.origin === 'auto')).toBe(true);
    expect(planting.body.features.map(({ properties }) => properties.id)).toEqual(
      service.features.map(({ properties }) => properties.id),
    );
  });

  test('правка создаёт версию: удаление, перемещение, добавление; id сервиса те же', async () => {
    const [first, second] = (await versionOf(1)).features;
    if (first === undefined || second === undefined) throw new Error('нет посадок');

    const { response, body } = await editOf(1, {
      name: '  Вариант у школы ',
      delete: [first.properties.id],
      update: [{ id: second.properties.id, lon: 9, lat: 3, x: 9, y: 3 }],
      add: [{ client_id: 'draft-1', lon: 30, lat: 10, x: 30, y: 10, plant_type: 'shrub' }],
    });

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ id: 2, kind: 'manual', name: 'Вариант у школы', based_on: 1 });
    const added = body.added_ids['draft-1'];
    const version = await versionOf(2);
    const byId = new Map(version.features.map(({ properties }) => [properties.id, properties]));
    expect(byId.has(first.properties.id)).toBe(false);
    expect(byId.get(second.properties.id)).toMatchObject({
      origin: 'manual',
      rule_id: 'TREE_ROW_CURB',
    });
    expect(added === undefined ? undefined : byId.get(added)).toMatchObject({
      plant_type: 'shrub',
      rule_id: null,
      origin: 'manual',
    });
    expect(body.planting_count).toBe(version.features.length);

    // /planting — последняя версия, в прежнем формате.
    const planting = await call<Schemas['PlantingFeatureCollection']>(
      `/projects/${READY_LOCAL}/planting`,
    );
    expect(planting.body.features).toHaveLength(version.features.length);
    expect(planting.body.features.some(({ properties }) => 'origin' in properties)).toBe(false);
  });

  test('правится и не последняя версия; удалённая посадка сервиса возвращается через update', async () => {
    const [first] = (await versionOf(1)).features;
    if (first === undefined) throw new Error('нет посадок');
    const [x = 0, y = 0] = first.geometry.coordinates;
    await editOf(1, { delete: [first.properties.id] });

    const second = await editOf(1, {
      update: [{ id: first.properties.id, lon: x + 1, lat: y, x: x + 1, y }],
    });
    const restored = await editOf(2, {
      update: [{ id: first.properties.id, lon: x, lat: y, x, y }],
    });

    expect(second.body).toMatchObject({ id: 3, based_on: 1 });
    expect(restored.body).toMatchObject({ id: 4, based_on: 2 });
    const back = (await versionOf(4)).features.find(
      ({ properties }) => properties.id === first.properties.id,
    );
    expect(back?.properties.origin).toBe('auto');
    expect(back?.properties.rule_id).toBe(first.properties.rule_id);
  });

  test('DXF — по версии; без параметра — последняя, нет версии — 404', async () => {
    const service = await versionOf(1);
    await editOf(1, {
      delete: service.features.slice(3).map(({ properties }) => properties.id),
    });
    const circles = async (query: string) => {
      const response = await fetch(`/api/projects/${READY_LOCAL}/dxf${query}`);
      return (await response.text()).split('\r\nCIRCLE\r\n').length - 1;
    };

    expect(await circles('')).toBe(3);
    expect(await circles('?version=1')).toBe(service.features.length);
    expect((await fetch(`/api/projects/${READY_LOCAL}/dxf?version=9`)).status).toBe(404);
  });

  test('точка чертежа — присланная: в версии и в её DXF, а не пересчёт lon, lat', async () => {
    const [first] = (await versionOf(1)).features;
    if (first === undefined) throw new Error('нет посадок');

    await editOf(1, {
      update: [{ id: first.properties.id, lon: 5, lat: 6, x: 123.4567, y: -89.0123 }],
      add: [{ client_id: 'draft-1', lon: 7, lat: 8, x: 321.5, y: 45.25, plant_type: 'tree' }],
    });

    const version = await versionOf(2);
    expect(
      version.features.find(({ properties }) => properties.id === first.properties.id)?.properties,
    ).toMatchObject({ x: 123.4567, y: -89.0123 });
    const dxf = await (await fetch(`/api/projects/${READY_LOCAL}/dxf?version=2`)).text();
    expect(dxf).toContain(' 10\r\n123.4567\r\n 20\r\n-89.0123\r\n');
    expect(dxf).toContain(' 10\r\n321.5000\r\n 20\r\n45.2500\r\n');
    expect(dxf).not.toContain(' 10\r\n5.0000\r\n 20\r\n6.0000\r\n');
  });

  test('пустая правка, чужой id, id в двух списках, некорректное тело — 422; нет версии — 404', async () => {
    const [first] = (await versionOf(1)).features;
    if (first === undefined) throw new Error('нет посадок');
    const id = first.properties.id;

    expect((await editOf(1, {})).response.status).toBe(422);
    expect((await editOf(1, { delete: ['NO-SUCH'] })).response.status).toBe(422);
    expect(
      (await editOf(1, { delete: [id], update: [{ id, lon: 1, lat: 1, x: 1, y: 1 }] })).response
        .status,
    ).toBe(422);
    const malformed = { add: [{ lon: 'x' }], update: [], delete: [] };
    expect((await post(`${versionUrl(1)}/edit`, malformed)).response.status).toBe(422);
    expect((await editOf(7, { delete: [id] })).response.status).toBe(404);
  });

  test('новая обработка начинает историю заново', async () => {
    const [first] = (await versionOf(1)).features;
    if (first === undefined) throw new Error('нет посадок');
    await editOf(1, { delete: [first.properties.id] });

    await post(`/projects/${READY_LOCAL}/runs`, {});
    vi.setSystemTime(Date.now() + 25_000);

    const { body } = await call<Schemas['PlantingVersion'][]>(`/projects/${READY_LOCAL}/plantings`);
    expect(body.map(({ id }) => id)).toEqual([1]);
  });
});

describe('ручная геопривязка', () => {
  const georeference = {
    anchor_wgs84: { lat: 55.7, lon: 37.6 },
    anchor_drawing: { x: 0, y: 0 },
    rotation_deg: 90,
    scale: 1,
    method: 'manual',
    rms_m: null,
    control_points: [],
  };

  test('проект без привязки переобрабатывается в WGS84 с присланными параметрами', async () => {
    const { response, body } = await put<ProjectResponse>(
      `/projects/${READY_LOCAL}/georeference`,
      georeference,
    );
    expect(response.status).toBe(202);
    expect(body.status).toBe('queued');

    vi.setSystemTime(Date.now() + 25_000);
    const project = (await call<ProjectResponse>(`/projects/${READY_LOCAL}`)).body;
    expect(project.job.georeference?.confidence).toBe('manual');
    const zones = await call<Schemas['ZonesFeatureCollection']>(`/projects/${READY_LOCAL}/zones`);
    expect(zones.body.metadata.crs).toBe('EPSG:4326 (WGS84 lon/lat)');

    // Дерево в (3; 2,2) при повороте на 90° против часовой: 2,2 м на запад и 3 м на север.
    const planting = await call<Schemas['PlantingFeatureCollection']>(
      `/projects/${READY_LOCAL}/planting`,
    );
    const [lon = 0, lat = 0] =
      planting.body.features.find(({ properties }) => properties.id === 'TREE_ROW_CURB-00001')
        ?.geometry.coordinates ?? [];
    expect((lon - 37.6) * 62_900).toBeCloseTo(-2.2, 1);
    expect((lat - 55.7) * 111_360).toBeCloseTo(3, 1);
  });

  // Мок кладёт чертёж на местность той же функцией, что модуль геопривязки и план проекта
  // с ручной привязкой: привязка, применённая в браузере и на сервере-моке, даёт одну картину.
  test('координаты после привязки — те же, что у клиента по той же привязке', async () => {
    const drawing = await call<Schemas['PlantingFeatureCollection']>(
      `/projects/${READY_LOCAL}/planting`,
    );
    const body = {
      ...georeference,
      anchor_drawing: { x: 30, y: 8.5 },
      rotation_deg: 17.5,
      scale: 1.02,
    };
    await put(`/projects/${READY_LOCAL}/georeference`, body);
    vi.setSystemTime(Date.now() + 25_000);
    const placed = await call<Schemas['PlantingFeatureCollection']>(
      `/projects/${READY_LOCAL}/planting`,
    );

    const { toLatLon } = placementTransform({
      source: { center: body.anchor_drawing },
      anchor: body.anchor_wgs84,
      rotation: body.rotation_deg,
      scale: body.scale,
    });
    for (const [index, feature] of drawing.body.features.entries()) {
      const [x = 0, y = 0] = feature.geometry.coordinates;
      const { lat, lon } = toLatLon({ x, y });
      expect(placed.body.features[index]?.geometry.coordinates).toEqual([lon, lat]);
    }
  });

  test('привязка спасает проект, упавший на геопривязке', async () => {
    // «Улица Бахрушина, 11»: insufficient_geodetic_points на этапе georeferencing.
    const failed = 'e5b7d9f1a3c54f6e8a0c2e4b6d8f1a3c';
    vi.setSystemTime(Date.now() + 60_000);
    expect((await call<ProjectResponse>(`/projects/${failed}`)).body.status).toBe('failed');

    const { response } = await put(`/projects/${failed}/georeference`, georeference);
    expect(response.status).toBe(202);
    vi.setSystemTime(Date.now() + 25_000);

    expect((await call<ProjectResponse>(`/projects/${failed}`)).body.status).toBe('ready');
  });

  test('привязка сохраняет главный чертёж, выбранный через /runs', async () => {
    // «Сквер на Новослободской»: несколько главных чертежей, выбор — через /runs.
    const ambiguous = 'd1f3b5d7e9a14e2c4b6d8f0a2c4e6b8d';
    vi.setSystemTime(Date.now() + 60_000);
    await call(`/projects/${ambiguous}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root_dxf: 'ГП/Генплан.dxf' }),
    });
    vi.setSystemTime(Date.now() + 25_000);
    expect((await call<ProjectResponse>(`/projects/${ambiguous}`)).body.status).toBe('ready');

    await put(`/projects/${ambiguous}/georeference`, georeference);
    vi.setSystemTime(Date.now() + 25_000);

    expect((await call<ProjectResponse>(`/projects/${ambiguous}`)).body.status).toBe('ready');
  });

  test('некорректный масштаб — 422, обработка не начинается', async () => {
    const { response } = await put(`/projects/${READY_LOCAL}/georeference`, {
      ...georeference,
      scale: 0,
    });

    expect(response.status).toBe(422);
    expect((await call<ProjectResponse>(`/projects/${READY_LOCAL}`)).body.status).toBe('ready');
  });
});

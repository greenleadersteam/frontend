import { beforeEach, describe, expect, test, vi } from 'vitest';

import { placementTransform } from '@/shared/lib/georeference';

import type { components as Proposed } from '../generated/proposed';
import type { components as Real } from '../generated/schema';
import { resetMockDb } from './node';

type Schemas = Proposed['schemas'];
type RealSchemas = Real['schemas'];
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

// Модель сервера: ../backend/greenplan/api/plantings.py и тесты tests/api/test_plantings.py.
describe('версии плана посадок', () => {
  const versionUrl = (version: number | string) =>
    `/projects/${READY_LOCAL}/plantings/${String(version)}`;
  const versionOf = async (version: number) =>
    (await call<Schemas['PlantingFeatureCollection']>(versionUrl(version))).body;
  const editOf = (version: number, edit: Partial<RealSchemas['PlantingEdit']>) =>
    post<RealSchemas['PlantingEditResponse']>(`${versionUrl(version)}/edit`, {
      add: [],
      update: [],
      delete: [],
      ...edit,
    });
  // DXF и объяснения правленой версии «сервер» собирает несколько секунд.
  const exportDone = () => {
    vi.setSystemTime(Date.now() + 5000);
  };
  const errorTypes = (body: unknown) =>
    typeof body === 'object' && body !== null && 'detail' in body && Array.isArray(body.detail)
      ? body.detail.map((item: unknown) =>
          typeof item === 'object' && item !== null && 'type' in item ? item.type : null,
        )
      : [];

  test('до правок — одна версия: расстановка обработки, она же в /planting', async () => {
    const { body } = await call<RealSchemas['PlantingVersion'][]>(
      `/projects/${READY_LOCAL}/plantings`,
    );
    const service = await versionOf(1);
    const planting = await call<Schemas['PlantingFeatureCollection']>(
      `/projects/${READY_LOCAL}/planting`,
    );

    expect(body).toEqual([
      expect.objectContaining({
        id: 1,
        kind: 'auto',
        name: 'Автоматическая посадка',
        based_on: null,
        export_status: 'ready',
      }),
    ]);
    expect(body[0]?.counts.total).toBe(service.features.length);
    expect(planting.body.features.map(({ properties }) => properties.id)).toEqual(
      service.features.map(({ properties }) => properties.id),
    );
  });

  test('правка создаёт версию: удаление, перемещение, добавление; id сервиса те же', async () => {
    const [first, second] = (await versionOf(1)).features;
    if (first === undefined || second === undefined) throw new Error('нет посадок');

    const { response, body } = await editOf(1, {
      name: 'Вариант у школы',
      delete: [first.properties.id],
      update: [{ id: second.properties.id, lon: 9, lat: 3 }],
      add: [{ client_id: 'draft-1', lon: 30, lat: 10, plant_type: 'shrub' }],
    });

    expect(response.status).toBe(201);
    expect(body.version).toMatchObject({
      id: 2,
      kind: 'manual',
      name: 'Вариант у школы',
      based_on: 1,
    });
    expect(body.id_map).toEqual({ 'draft-1': 'manual-00001' });
    const version = await versionOf(2);
    const byId = new Map(version.features.map(({ properties }) => [properties.id, properties]));
    expect(byId.has(first.properties.id)).toBe(false);
    // Перемещённая остаётся посадкой сервиса со своим правилом.
    expect(byId.get(second.properties.id)).toMatchObject({
      kind: 'auto',
      rule_id: 'TREE_ROW_CURB',
    });
    expect(byId.get('manual-00001')).toMatchObject({
      plant_type: 'shrub',
      rule_id: null,
      kind: 'manual',
      added_in_version: 2,
    });
    expect(body.version.counts.total).toBe(version.features.length);

    // /planting — последняя версия.
    const planting = await call<Schemas['PlantingFeatureCollection']>(
      `/projects/${READY_LOCAL}/planting`,
    );
    expect(planting.body.features).toHaveLength(version.features.length);
  });

  test('без имени — «Версия N»; правится и не последняя версия', async () => {
    const [first] = (await versionOf(1)).features;
    if (first === undefined) throw new Error('нет посадок');
    await editOf(1, { delete: [first.properties.id] });

    const second = await editOf(1, { update: [{ id: first.properties.id, plant_type: 'shrub' }] });

    expect(second.body.version).toMatchObject({ id: 3, based_on: 1, name: 'Версия 3' });
  });

  test('удалённую в версии посадку сервиса правка не знает — unknown_id; вернуть её можно добавлением', async () => {
    const [first] = (await versionOf(1)).features;
    if (first === undefined) throw new Error('нет посадок');
    const [x = 0, y = 0] = first.geometry.coordinates;
    await editOf(1, { delete: [first.properties.id] });

    const restoredById = await editOf(2, { update: [{ id: first.properties.id, lon: x, lat: y }] });
    const restoredByAdd = await editOf(2, {
      add: [{ client_id: first.properties.id, lon: x, lat: y, plant_type: 'tree' }],
    });

    expect(restoredById.response.status).toBe(422);
    expect(errorTypes(restoredById.body)).toEqual(['unknown_id']);
    expect(restoredByAdd.body.id_map[first.properties.id]).toBe('manual-00001');
  });

  test('DXF — по версии; /dxf — последняя; нет версии — 404', async () => {
    const service = await versionOf(1);
    await editOf(1, { delete: service.features.slice(3).map(({ properties }) => properties.id) });
    exportDone();
    const circles = async (path: string) => {
      const response = await fetch(`/api/projects/${READY_LOCAL}/${path}`);
      return (await response.text()).split('\r\nCIRCLE\r\n').length - 1;
    };

    expect(await circles('dxf')).toBe(3);
    expect(await circles('plantings/1/dxf')).toBe(service.features.length);
    expect((await fetch(`/api${versionUrl(9)}/dxf`)).status).toBe(404);
  });

  test('DXF новой версии сначала собирается: 202 с Retry-After, затем файл', async () => {
    const [first] = (await versionOf(1)).features;
    if (first === undefined) throw new Error('нет посадок');
    const { body } = await editOf(1, { delete: [first.properties.id] });
    expect(body.version.export_status).toBe('pending');

    const pending = await fetch(`/api${versionUrl(2)}/dxf`);
    expect(pending.status).toBe(202);
    expect(pending.headers.get('Retry-After')).toBe('2');
    expect(await pending.json()).toEqual({ version: 2, export_status: 'pending' });
    expect((await fetch(`/api/projects/${READY_LOCAL}/dxf`)).status).toBe(202);

    exportDone();
    const versions = await call<RealSchemas['PlantingVersion'][]>(
      `/projects/${READY_LOCAL}/plantings`,
    );
    expect(versions.body.at(-1)?.export_status).toBe('ready');
    const ready = await fetch(`/api${versionUrl(2)}/dxf`);
    expect(ready.status).toBe(200);
    expect(ready.headers.get('Content-Type')).toBe('image/vnd.dxf');
  });

  test('точку чертежа считает сервер: без привязки — та же точка плана', async () => {
    const [first] = (await versionOf(1)).features;
    if (first === undefined) throw new Error('нет посадок');

    await editOf(1, { update: [{ id: first.properties.id, lon: 5, lat: 6 }] });
    exportDone();

    const dxf = await (await fetch(`/api${versionUrl(2)}/dxf`)).text();
    expect(dxf).toContain(' 10\r\n5.0000\r\n 20\r\n6.0000\r\n');
  });

  test('объяснения версии: перемещённая и добавленная помечены, зоны сервер не проверял', async () => {
    const [first] = (await versionOf(1)).features;
    if (first === undefined) throw new Error('нет посадок');
    const [x = 0, y = 0] = first.geometry.coordinates;
    await editOf(1, {
      update: [{ id: first.properties.id, lon: x + 3, lat: y + 4 }],
      add: [{ client_id: 'draft-1', lon: 1, lat: 2, plant_type: 'tree' }],
    });
    exportDone();

    const { body } = await call<RealSchemas['ExplanationEntry'][]>(
      `/projects/${READY_LOCAL}/plantings/2/explanation`,
    );
    const byId = new Map(body.map((entry) => [entry.id, entry]));
    expect(byId.get(first.properties.id)).toMatchObject({
      kind: 'auto',
      moved: true,
      displacement_m: 5,
      zone_check: 'not_checked',
    });
    expect(byId.get('manual-00001')).toMatchObject({
      kind: 'manual',
      rule_id: null,
      added_in_version: 2,
      zone_check: 'not_checked',
    });
  });

  test('ошибки правки — 422 с кодами сервера; нет версии — 404', async () => {
    const [first] = (await versionOf(1)).features;
    if (first === undefined) throw new Error('нет посадок');
    const id = first.properties.id;
    const typesOf = async (edit: Partial<RealSchemas['PlantingEdit']>) => {
      const { response, body } = await editOf(1, edit);
      expect(response.status).toBe(422);
      return errorTypes(body);
    };

    expect(await typesOf({})).toEqual(['empty_edit']);
    expect(await typesOf({ delete: ['NO-SUCH'] })).toEqual(['unknown_id']);
    expect(await typesOf({ delete: [id], update: [{ id, lon: 1, lat: 1 }] })).toEqual([
      'update_delete_conflict',
    ]);
    expect(await typesOf({ update: [{ id, lon: 1 }] })).toEqual(['lon_lat_pair']);
    expect(await typesOf({ update: [{ id }] })).toEqual(['nothing_to_update']);
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

    const { body } = await call<RealSchemas['PlantingVersion'][]>(
      `/projects/${READY_LOCAL}/plantings`,
    );
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

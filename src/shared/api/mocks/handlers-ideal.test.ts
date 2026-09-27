import { beforeEach, describe, expect, test, vi } from 'vitest';

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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  resetMockDb();
});

describe('нормы и породы', () => {
  test('/norms — у каждой нормы источник; пункт только там, где значение сервиса совпадает', async () => {
    const { body } = await call<Schemas['Norm'][]>('/norms');

    expect(new Set(body.map(({ id }) => id)).size).toBe(body.length);
    expect(
      body
        .filter(({ clause }) => clause !== null)
        .map(({ id }) => id)
        .sort(),
    ).toEqual(['743-pp-comm-cable', '743-pp-heat', '743-pp-power-cable', '743-pp-road-edge']);
    for (const norm of body.filter(({ id }) => id !== '743-pp-other-utility')) {
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
      norm_id: '743-pp-power-cable',
    });
    expect(first?.checks?.find(({ category }) => category === 'road_edge')?.actual_m).toBe(2.2);
    for (const entry of body) {
      for (const check of entry.checks ?? []) {
        expect(check.actual_m).toBeGreaterThanOrEqual(check.required_m);
        expect(norms.some(({ id }) => id === check.norm_id)).toBe(true);
      }
    }
  });

  test('/obstacles — сети, здания, борт и тротуар, без путей сервера', async () => {
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
      ]),
    );
    const text = JSON.stringify(body);
    expect(text).not.toContain('source_file');
    expect(text).not.toContain('source_folder');
    expect(body.metadata.crs).toBe('local drawing coordinates, no geo-reference available');
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

describe('правки посадок', () => {
  const editedFrom = async () => {
    const { body } = await call<Schemas['PlantingFeatureCollection']>(
      `/projects/${READY_LOCAL}/planting`,
    );
    const features: Schemas['EditedPlanting'][] = body.features.map(({ geometry, properties }) => ({
      type: 'Feature',
      geometry,
      properties: {
        id: properties.id,
        plant_type: properties.plant_type,
        species_id: properties.species_id ?? null,
        origin: 'auto',
      },
    }));
    return { metadata: body.metadata, features };
  };

  test('до правок GET /plantings — 204: правок не было', async () => {
    const { response, body } = await call(`/projects/${READY_LOCAL}/plantings`);

    expect(response.status).toBe(204);
    expect(body).toBeNull();
  });

  test('шаг — из параметров обработки: после /runs с шагом 4 м посадки в 4,5 м допустимы', async () => {
    await call(`/projects/${READY_LOCAL}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planting_rules: { TREE_ROW_CURB: { spacing_m: 4 }, TREE_FILL_LAWN: { spacing_m: 4 } },
      }),
    });
    vi.setSystemTime(Date.now() + 25_000);
    const edited = await editedFrom();
    const [first] = edited.features;
    if (first === undefined) throw new Error('нет посадок');
    edited.features.push(
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [16, 9] },
        properties: { id: 'MANUAL-1', plant_type: 'tree', species_id: null, origin: 'manual' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [16, 13.5] },
        properties: { id: 'MANUAL-2', plant_type: 'tree', species_id: null, origin: 'manual' },
      },
    );

    const { body } = await put<Schemas['CheckedPlantingsFeatureCollection']>(
      `/projects/${READY_LOCAL}/plantings`,
      { type: 'FeatureCollection', ...edited },
    );

    // По умолчанию наименьший шаг деревьев — 5 м: 4,5 м между посадками было бы нарушением.
    const manual = body.features.filter(({ properties }) => properties.origin === 'manual');
    expect(
      manual.map(({ properties }) => properties.rejection?.reason ?? properties.status),
    ).toEqual(['allowed', 'allowed']);
  });

  test('статус — по точному расстоянию: 1,496 м от газопровода — в зоне запрета', async () => {
    const edited = await editedFrom();
    const [first] = edited.features;
    if (first === undefined) throw new Error('нет посадок');
    // Газопровод на y = 12, отступ дерева 1,5 м: округлённое actual_m — 1,5.
    first.geometry = { type: 'Point', coordinates: [9, 12 - 1.496] };

    const { body } = await put<Schemas['CheckedPlantingsFeatureCollection']>(
      `/projects/${READY_LOCAL}/plantings`,
      { type: 'FeatureCollection', ...edited },
    );

    const checked = body.features.find(({ properties }) => properties.id === first.properties.id);
    expect(checked?.properties.status).toBe('forbidden');
    expect(checked?.properties.checks.find(({ subtype }) => subtype === 'gas')?.actual_m).toBe(1.5);
  });

  test('перепроверка: в зоне запрета — forbidden, у соседа — rejected по шагу, за газоном — outside_site', async () => {
    const edited = await editedFrom();
    const [first, second] = edited.features;
    if (first === undefined || second === undefined) throw new Error('нет посадок');
    // Второе дерево ряда — на газопровод (y = 12, отступ 1,5 м).
    second.geometry = { type: 'Point', coordinates: [9, 12] };
    edited.features.push(
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [3.5, 2.2] },
        properties: { id: 'MANUAL-1', plant_type: 'tree', species_id: null, origin: 'manual' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [30, 25] },
        properties: { id: 'MANUAL-2', plant_type: 'tree', species_id: null, origin: 'manual' },
      },
    );

    const { response, body } = await put<Schemas['CheckedPlantingsFeatureCollection']>(
      `/projects/${READY_LOCAL}/plantings`,
      { type: 'FeatureCollection', ...edited },
    );

    expect(response.status).toBe(200);
    const byId = new Map(body.features.map(({ properties }) => [properties.id, properties]));
    const moved = byId.get(second.properties.id);
    expect(moved?.status).toBe('forbidden');
    expect(moved?.checks.some(({ actual_m, required_m }) => actual_m < required_m)).toBe(true);
    expect(byId.get('MANUAL-1')).toMatchObject({
      status: 'rejected',
      origin: 'manual',
      rejection: { reason: 'spacing', neighbour_id: first.properties.id },
    });
    expect(byId.get('MANUAL-1')?.rejection?.text_ru).toBe(
      'До соседней посадки 0,5\u00A0м при шаге 5\u00A0м',
    );
    expect(byId.get('MANUAL-2')?.rejection?.reason).toBe('outside_site');
    const untouched = body.features.filter(
      ({ properties }) =>
        ![first.properties.id, second.properties.id, 'MANUAL-1', 'MANUAL-2'].includes(
          properties.id,
        ),
    );
    expect(untouched.every(({ properties }) => properties.status === 'allowed')).toBe(true);

    const saved = await call<Schemas['CheckedPlantingsFeatureCollection']>(
      `/projects/${READY_LOCAL}/plantings`,
    );
    expect(saved.body.features).toHaveLength(body.features.length);
  });

  test('DXF — вариант с правками по умолчанию, ?variant=original — исходный', async () => {
    const edited = await editedFrom();
    const original = edited.features.length;
    edited.features = edited.features.slice(0, 3);
    await put(`/projects/${READY_LOCAL}/plantings`, { type: 'FeatureCollection', ...edited });

    const circles = async (query: string) => {
      const response = await fetch(`/api/projects/${READY_LOCAL}/dxf${query}`);
      return (await response.text()).split('\r\nCIRCLE\r\n').length - 1;
    };

    expect(await circles('')).toBe(3);
    expect(await circles('?variant=original')).toBe(original);
  });

  test('некорректное тело — 422', async () => {
    const { response } = await put(`/projects/${READY_LOCAL}/plantings`, {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { coordinates: ['x'] }, properties: {} }],
    });

    expect(response.status).toBe(422);
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

import { afterEach, describe, expect, test, vi } from 'vitest';

import type {
  ExplanationEntry,
  Norm,
  ObstaclesFeatureCollection,
  ZonesFeatureCollection,
} from '../api/project-result-api';
import { createLocalFrame } from './local-frame';
import { checksAgainstObstacles, prepareObstacles } from './obstacle-checks';

// Координаты чертежа в метрах, центр охвата — в нуле: локальные метры совпадают с данными.
const frame = createLocalFrame({ minX: -100, minY: -100, maxX: 100, maxY: 100 }, false);

type Geometry = ObstaclesFeatureCollection['features'][number]['geometry'];

const obstacle = (category: string, subtype: string | null, geometry: Geometry) => ({
  type: 'Feature' as const,
  geometry,
  properties: {
    rule_id: '3',
    category,
    subtype,
    status: 'auto',
    layer: 'Слой',
    dxftype: 'LWPOLYLINE',
    handle: '2C7',
  },
});

const collection = (
  features: ObstaclesFeatureCollection['features'],
): ObstaclesFeatureCollection => ({
  type: 'FeatureCollection',
  metadata: { crs: 'local drawing coordinates, no geo-reference available' },
  features,
});

const norm = (
  subtype: string,
  plantType: 'tree' | 'shrub',
  distance: number,
  clause: string | null,
): Norm => ({
  id: `743-pp-${subtype}-${plantType}`,
  obstacle_category: 'underground_utilities',
  obstacle_subtype: subtype,
  plant_type: plantType,
  distance_m: distance,
  citation: `743-ПП — ${subtype}`,
  act: 'ПП Москвы от 10.09.2002 № 743-ПП, прил. 1',
  clause,
  text: subtype,
  source_url: null,
});

const NORMS = [
  norm('gas', 'tree', 1.5, 'п. 3.6.3'),
  norm('gas', 'shrub', 1.5, null),
  norm('power_cable', 'tree', 2, 'п. 3.6.3'),
];

// Зона запрета от водопровода: без записи в /norms норма берётся из неё.
const zones: ZonesFeatureCollection = {
  type: 'FeatureCollection',
  metadata: { crs: 'local', used_site_boundary: true, uncovered_categories: [] },
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
      properties: {
        zone_type: 'prohibited',
        plant_type: 'tree',
        obstacle_category: 'underground_utilities',
        obstacle_subtype: 'water',
        distance_m: 2,
        citation: '743-ПП — водопровод, дренаж',
        reason: '< 2 м',
      },
    },
  ],
};

const segment = (from: number[], to: number[]): Geometry => ({
  type: 'LineString',
  coordinates: [from, to],
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checksAgainstObstacles', () => {
  const prepared = prepareObstacles(
    collection([
      // Газопровод — ломаная, ближе к посадке её второй отрезок.
      obstacle('underground_utilities', 'gas', {
        type: 'LineString',
        coordinates: [
          [-20, 10],
          [0, 10],
          [0, 4],
        ],
      }),
      // Кабель — мультилиния: две ветки, ближе вторая.
      obstacle('underground_utilities', 'power_cable', {
        type: 'MultiLineString',
        coordinates: [
          [
            [-20, -9],
            [20, -9],
          ],
          [
            [-20, -3],
            [20, -3],
          ],
        ],
      }),
      obstacle('underground_utilities', 'water', segment([3, -20], [3, 20])),
      // Колодец: нормы нет — проверки нет.
      obstacle('wells_hatches', null, { type: 'Point', coordinates: [1, 1] }),
    ]),
    NORMS,
    zones,
    frame,
  );

  test('расстояние — до ближайшей точки линии и мультилинии, точка на объекте для размера', () => {
    const checks = checksAgainstObstacles([-2, 0], 'tree', undefined, prepared);

    expect(checks.map(({ subtype, actual, point }) => [subtype, actual, point])).toEqual([
      // Запас: водопровод 5 − 2 = 3, кабель 3 − 2 = 1, газ √(4 + 16) − 1,5.
      ['power_cable', 3, [-2, -3]],
      ['gas', Math.hypot(2, 4), [0, 4]],
      ['water', 5, [3, 0]],
    ]);
  });

  test('норма — из /norms для типа посадки, без записи — из зоны запрета', () => {
    const checks = checksAgainstObstacles([-2, 0], 'tree', undefined, prepared);
    const bySubtype = new Map(checks.map((check) => [check.subtype, check]));

    expect(bySubtype.get('gas')).toMatchObject({
      required: 1.5,
      norm: { id: '743-pp-gas-tree', clause: 'п. 3.6.3' },
    });
    expect(bySubtype.get('water')).toMatchObject({
      required: 2,
      citation: '743-ПП — водопровод, дренаж',
      norm: null,
    });
    // У кустарника в /norms только газ: кабель и водопровод без нормы не проверяются.
    expect(
      checksAgainstObstacles([-2, 0], 'shrub', undefined, prepared).map(({ norm }) => norm?.id),
    ).toEqual(['743-pp-gas-shrub']);
  });

  test('дальше порога (тройная наибольшая норма) объект не проверяется', () => {
    // Для деревьев порог 3 · 2 = 6 м: газопровод в 10 м и дальше — вне списка.
    const far = checksAgainstObstacles([-15, 30], 'tree', undefined, prepared);

    expect(far).toEqual([]);
    expect(prepared.threshold).toEqual({ tree: 6, shrub: 4.5 });
  });

  test('внутри здания расстояние — ноль', () => {
    const building = prepareObstacles(
      collection([
        obstacle('buildings', null, {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
              [0, 0],
            ],
          ],
        }),
      ]),
      [{ ...norm('x', 'tree', 5, null), obstacle_category: 'buildings', obstacle_subtype: null }],
      zones,
      frame,
    );

    const [check] = checksAgainstObstacles([2, 5], 'tree', undefined, building);

    expect(check).toMatchObject({ category: 'buildings', actual: 0, point: [2, 5] });
  });

  test('нарушение — с допуском 2 см: хорда буфера shapely недобирает сантиметр', () => {
    // Кабель на y = −3: на 1,99 м от него — вплотную к зоне, на 1,97 м — ближе нормы.
    const at = (y: number) =>
      checksAgainstObstacles([-2, y], 'tree', undefined, prepared).find(
        ({ subtype }) => subtype === 'power_cable',
      )?.violated;

    expect(at(-1.01)).toBe(false);
    expect(at(-1.03)).toBe(true);
  });

  test('серверные checks первичны: список и числа — сервера, точка — своя', () => {
    const server: NonNullable<ExplanationEntry['checks']> = [
      {
        category: 'underground_utilities',
        subtype: 'gas',
        required_m: 1.5,
        actual_m: 4.47,
        citation: '743-ПП — газопровод',
        norm_id: '743-pp-gas-tree',
      },
      // Объекта нет рядом в /obstacles: проверка есть, линии нет.
      {
        category: 'road_edge',
        subtype: null,
        required_m: 0.7,
        actual_m: 12,
        citation: '743-ПП — край тротуара/бортовой камень',
      },
    ];

    const checks = checksAgainstObstacles([-2, 0], 'tree', server, prepared);

    expect(checks).toMatchObject([
      {
        subtype: 'gas',
        actual: 4.47,
        required: 1.5,
        point: [0, 4],
        norm: { id: '743-pp-gas-tree' },
      },
      { category: 'road_edge', actual: 12, point: null, obstacle: null, norm: null },
    ]);
  });

  test('расхождение с сервером больше 5 см — предупреждение в консоли dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const check = (actual: number) => [
      {
        category: 'underground_utilities',
        subtype: 'gas',
        required_m: 1.5,
        actual_m: actual,
        citation: '743-ПП — газопровод',
      },
    ];

    checksAgainstObstacles([-2, 0], 'tree', check(4.47), prepared);
    expect(warn).not.toHaveBeenCalled();

    checksAgainstObstacles([-2, 0], 'tree', check(4.4), prepared);
    expect(warn).toHaveBeenCalledOnce();
  });
});

test('индекс отрезков находит то же, что полный перебор', () => {
  // Длинные отрезки через много ячеек, короткие и точка — в разных местах участка.
  const lines = [
    [
      [-300, -250],
      [310, 190],
    ],
    [
      [40, 40],
      [41, 44],
    ],
    [
      [-7, 123],
      [-7, 123],
    ],
    [
      [100, -300],
      [100, 300],
      [-200, 300],
    ],
  ];
  const wide = createLocalFrame({ minX: -300, minY: -300, maxX: 300, maxY: 300 }, false);
  const prepared = prepareObstacles(
    collection(
      lines.map((coordinates) =>
        obstacle('underground_utilities', 'gas', { type: 'LineString', coordinates }),
      ),
    ),
    NORMS,
    zones,
    wide,
  );
  const bruteForce = ([px, py]: readonly [number, number], radius: number) =>
    lines.flatMap((line, index) => {
      let best = Infinity;
      for (let vertex = 1; vertex < line.length; vertex += 1) {
        const [ax = 0, ay = 0] = line[vertex - 1] ?? [];
        const [bx = 0, by = 0] = line[vertex] ?? [];
        const dx = bx - ax;
        const dy = by - ay;
        const length = dx * dx + dy * dy;
        const t =
          length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
        best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
      }
      return best <= radius ? [[index, best]] : [];
    });

  for (let step = 0; step < 400; step += 1) {
    const point = [((step * 37) % 600) - 300, ((step * 53) % 600) - 300] as const;
    for (const radius of [1, 6, 17]) {
      const found = [...prepared.nearest(point, radius)].map(([index, { distance }]) => [
        index,
        distance,
      ]);
      const expected = bruteForce(point, radius);
      expect(found.map(([index]) => index).sort()).toEqual(expected.map(([index]) => index).sort());
      for (const [index, distance] of found) {
        expect(distance).toBeCloseTo(expected.find(([other]) => other === index)?.[1] ?? NaN, 9);
      }
    }
  }
});

test('выбор посадки на 10 000 посадок и 2 000 объектов: медиана до 30 мс', () => {
  // Сеть улиц 1 × 1 км: 1 000 ломаных сетей по 20 вершин в обе стороны и 1 000 кромок.
  const random = (() => {
    let seed = 42;
    return () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
  })();
  const polyline = (horizontal: boolean) => {
    const offset = random() * 1000 - 500;
    return Array.from({ length: 20 }, (_, index) => {
      const along = index * 50 - 500;
      const across = offset + random() * 4 - 2;
      return horizontal ? [along, across] : [across, along];
    });
  };
  const subtypes = ['gas', 'power_cable', 'water', 'heat', 'sewer'];
  const features = Array.from({ length: 2000 }, (_, index) =>
    index < 1000
      ? obstacle('underground_utilities', subtypes[index % subtypes.length] ?? 'gas', {
          type: 'LineString',
          coordinates: polyline(index % 2 === 0),
        })
      : obstacle('road_edge', null, { type: 'LineString', coordinates: polyline(index % 2 === 0) }),
  );
  const wide = createLocalFrame({ minX: -500, minY: -500, maxX: 500, maxY: 500 }, false);
  const prepared = prepareObstacles(
    collection(features),
    [
      ...NORMS,
      {
        ...norm('edge', 'tree', 0.7, null),
        obstacle_category: 'road_edge',
        obstacle_subtype: null,
      },
    ],
    zones,
    wide,
  );
  const plantings = Array.from(
    { length: 10_000 },
    () => [random() * 1000 - 500, random() * 1000 - 500] as const,
  );

  const durations = plantings.slice(0, 500).map((planting) => {
    const start = performance.now();
    checksAgainstObstacles(planting, 'tree', undefined, prepared);
    return performance.now() - start;
  });
  durations.sort((a, b) => a - b);

  expect(durations[durations.length / 2]).toBeLessThan(30);
});

import { describe, expect, test } from 'vitest';

import type { ZonesFeatureCollection } from '../api/project-result-api';
import { createLocalFrame } from './local-frame';
import {
  checksForPlanting,
  lawnArea,
  lawnSummary,
  type PlantingCheck,
  prepareZones,
  prohibitedArea,
} from './planting-checks';

type Feature = ZonesFeatureCollection['features'][number];
type Ring = number[][];

const rect = (x1: number, y1: number, x2: number, y2: number): Ring => [
  [x1, y1],
  [x2, y1],
  [x2, y2],
  [x1, y2],
  [x1, y1],
];

// Окружность 1024-угольником: расстояние до хорды отличается от расстояния до дуги меньше
// чем на R·(1 − cos(π/1024)) — доли миллиметра на радиусе в метры.
const circle = (cx: number, cy: number, radius: number): Ring =>
  Array.from({ length: 1025 }, (_, index) => {
    const angle = (index / 1024) * 2 * Math.PI;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });

const prohibited = (
  ring: Ring,
  distance: number,
  subtype = 'gas',
  plantType: 'tree' | 'shrub' = 'tree',
): Feature => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [ring] },
  properties: {
    zone_type: 'prohibited',
    plant_type: plantType,
    obstacle_category: 'underground_utilities',
    obstacle_subtype: subtype,
    distance_m: distance,
    citation: '743-ПП — газопровод',
    reason: `< ${String(distance)} м от объекта типа «${subtype}»`,
  },
});

const baseArea = (ring: Ring): Feature => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [ring] },
  properties: { zone_type: 'base_area' },
});

// Координаты чертежа: метры без проекции, центр — середина охвата.
const zones = (features: Feature[]): ZonesFeatureCollection => ({
  type: 'FeatureCollection',
  metadata: { crs: 'local', used_site_boundary: true, uncovered_categories: [] },
  features,
});

const EXTENT = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const frame = createLocalFrame(EXTENT, false);

const measured = (check: PlantingCheck | undefined) => {
  if (check?.kind !== 'measured')
    throw new Error(`ожидалась измеренная проверка: ${check?.kind ?? 'нет'}`);
  return check;
};

describe('checksForPlanting', () => {
  test('тождество буфера: зона — круг R + r, препятствие — круг R', () => {
    // Препятствие — колодец радиусом R = 1 м в (0, 0), норма r = 2 м: зона — круг 3 м.
    const prepared = prepareZones(
      zones([baseArea(rect(-50, -50, 50, 50)), prohibited(circle(0, 0, 3), 2)]),
      frame,
    );

    const check = measured(checksForPlanting([4, 3], 'tree', prepared)[0]);

    // До центра 5 м: до зоны 5 − 3 = 2, до препятствия 5 − 1 = 4 = r + запас.
    expect(check.margin).toBeCloseTo(2, 3);
    expect(check.actual).toBeCloseTo(4, 3);
    // Продолжение на r от кромки зоны приходит на окружность препятствия.
    const [ox = 0, oy = 0] = check.obstacle ?? [];
    expect(Math.hypot(ox, oy)).toBeCloseTo(1, 3);
  });

  test('срез по краю участка не принимается за буфер: расстояние — по несрезанной части', () => {
    // Сеть вдоль y = −1 за пределами участка, буфер 3 м срезан кромкой y = 0.
    const prepared = prepareZones(
      zones([baseArea(rect(0, 0, 40, 40)), prohibited(rect(0, 0, 40, 2), 3)]),
      frame,
    );

    const check = measured(checksForPlanting([20, 5], 'tree', prepared)[0]);

    expect(check.margin).toBeCloseTo(3);
    expect(check.actual).toBeCloseTo(6);
    expect(check.obstacle?.[1]).toBeCloseTo(-1);
  });

  test('ближайшая часть буфера могла быть срезана — только до границы зоны', () => {
    // Колодец за краем участка в (10, −1), буфер 3 м срезан кромкой y = 0. Посадка у кромки:
    // круг с радиусом «запас» вокруг неё выходит за участок.
    const prepared = prepareZones(
      zones([
        baseArea(rect(0, 0, 40, 40)),
        prohibited(
          circle(10, -1, 3).map(([x = 0, y = 0]) => [x, Math.max(y, 0)]),
          3,
        ),
      ]),
      frame,
    );

    const [check] = checksForPlanting([15, 0.5], 'tree', prepared);

    expect(check?.kind).toBe('boundary');
    // Ближайшая — точка среза (13, 0): круг прижат к кромке на всей ширине.
    expect(check?.kind === 'boundary' && check.margin).toBeCloseTo(Math.hypot(2, 0.5));
  });

  test('без контура допустимой области — только до границы зоны', () => {
    const prepared = prepareZones(zones([prohibited(rect(0, 0, 40, 2), 3)]), frame);

    expect(checksForPlanting([20, 5], 'tree', prepared)[0]?.kind).toBe('boundary');
  });

  test('посадка внутри зоны — дефект данных, сверху списка', () => {
    const prepared = prepareZones(
      zones([
        baseArea(rect(-50, -50, 50, 50)),
        prohibited(rect(-1, -1, 1, 1), 2, 'gas'),
        prohibited(rect(3, -1, 4, 1), 2, 'water'),
      ]),
      frame,
    );

    const checks = checksForPlanting([0, 0], 'tree', prepared);

    expect(checks.map(({ kind }) => kind)).toEqual(['inside', 'measured']);
  });

  test('миллиметры за кромкой — округление, а не нарушение', () => {
    const prepared = prepareZones(
      zones([baseArea(rect(-50, -50, 50, 50)), prohibited(rect(0, -1, 2, 1), 2)]),
      frame,
    );

    expect(checksForPlanting([0.005, 0], 'tree', prepared)[0]).toMatchObject({
      kind: 'measured',
      margin: 0.005,
    });
    expect(checksForPlanting([0.05, 0], 'tree', prepared)[0]?.kind).toBe('inside');
  });

  test('сортировка по запасу, порог — тройная наибольшая норма, тип посадки', () => {
    const prepared = prepareZones(
      zones([
        baseArea(rect(-100, -100, 100, 100)),
        prohibited(rect(5, -1, 6, 1), 2, 'water'),
        prohibited(rect(-3, -1, -2, 1), 2, 'gas'),
        // В 20 м: дальше 3 × 2 = 6 м от охвата — не рядом.
        prohibited(rect(20, -1, 21, 1), 2, 'heat'),
        // Зона для кустарников дереву не мешает.
        prohibited(rect(1, -1, 1.5, 1), 1, 'sewer', 'shrub'),
      ]),
      frame,
    );

    const checks = checksForPlanting([0, 0], 'tree', prepared);

    expect(checks.map((check) => check.zone.properties.obstacle_subtype)).toEqual(['gas', 'water']);
    expect(prepared.threshold).toEqual({ tree: 6, shrub: 3 });
  });

  test('ничего рядом — пустой список', () => {
    const prepared = prepareZones(zones([prohibited(rect(50, 50, 60, 60), 2)]), frame);

    expect(checksForPlanting([0, 0], 'tree', prepared)).toEqual([]);
  });
});

describe('prohibitedArea', () => {
  test('перекрытие зон не считается дважды: допустимая область без разрешённой', () => {
    // Участок 10 × 10, две зоны 4 × 10 и 4 × 10 перекрываются полосой 2 × 10.
    const prepared = prepareZones(
      zones([
        baseArea(rect(0, 0, 10, 10)),
        prohibited(rect(0, 0, 4, 10), 1, 'gas'),
        prohibited(rect(2, 0, 6, 10), 1, 'water'),
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [rect(6, 0, 10, 10)] },
          properties: { zone_type: 'allowed', plant_type: 'tree' },
        },
      ]),
      frame,
    );

    expect(prohibitedArea(prepared, 'tree')).toBeCloseTo(60);
    // Для кустарников разрешённой области нет — закрыт весь участок.
    expect(prohibitedArea(prepared, 'shrub')).toBeCloseTo(100);
  });
});

test('площадь газона — по lawn_raw; газона нет — null', () => {
  const lawn: Feature = {
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: [[rect(0, 0, 10, 10)], [rect(20, 0, 25, 4)]] },
    properties: { zone_type: 'lawn_raw' },
  };

  expect(lawnArea(prepareZones(zones([lawn, baseArea(rect(0, 0, 5, 5))]), frame))).toBeCloseTo(120);
  expect(lawnArea(prepareZones(zones([baseArea(rect(0, 0, 5, 5))]), frame))).toBeNull();
});

test('газон: площадь, посадки на нём и доля под запретом — от газона в границах участка', () => {
  const rect = (x1: number, y1: number, x2: number, y2: number) => ({
    type: 'Polygon' as const,
    coordinates: [
      [
        [x1, y1],
        [x2, y1],
        [x2, y2],
        [x1, y2],
        [x1, y1],
      ],
    ],
  });
  // Газон 100 × 100 м, в границах участка — левая половина, деревьям разрешена её половина.
  const zones: ZonesFeatureCollection = {
    type: 'FeatureCollection',
    metadata: { crs: 'local', used_site_boundary: true, uncovered_categories: [] },
    features: [
      { type: 'Feature', geometry: rect(0, 0, 100, 100), properties: { zone_type: 'lawn_raw' } },
      { type: 'Feature', geometry: rect(0, 0, 50, 100), properties: { zone_type: 'base_area' } },
      {
        type: 'Feature',
        geometry: rect(0, 0, 25, 100),
        properties: { zone_type: 'allowed', plant_type: 'tree' },
      },
      {
        type: 'Feature',
        geometry: rect(0, 0, 50, 100),
        properties: { zone_type: 'allowed', plant_type: 'shrub' },
      },
    ],
  };
  const frame = createLocalFrame({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, false);

  const summary = lawnSummary(
    prepareZones(zones, frame),
    [
      { point: [10, 10], plantType: 'tree' },
      { point: [60, 10], plantType: 'shrub' },
      { point: [150, 10], plantType: 'shrub' },
    ],
    true,
  );

  expect(summary).toEqual({
    area: 10_000,
    siteArea: 5000,
    trees: 1,
    shrubs: 1,
    prohibitedShare: { tree: 0.5, shrub: 0 },
  });
});

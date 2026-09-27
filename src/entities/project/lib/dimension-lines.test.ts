import { describe, expect, test } from 'vitest';

import { dimensionLines } from './dimension-lines';
import { createLocalFrame, type LocalPoint } from './local-frame';
import type { PlantingCheck, ProhibitedZone } from './planting-checks';

// Метры чертежа у экватора: условные lon/lat ≈ метры / 111 319,5 — проверяем в метрах обратно.
const frame = createLocalFrame({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, false);
const METERS_PER_DEGREE = (6_378_137 * Math.PI) / 180;
const toMeters = ([lon = 0, lat = 0]: number[]): LocalPoint => [
  lon * METERS_PER_DEGREE,
  lat * METERS_PER_DEGREE,
];

const zone = (distance: number): ProhibitedZone => ({
  index: 0,
  polygons: [],
  bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  properties: {
    zone_type: 'prohibited',
    plant_type: 'tree',
    obstacle_category: 'underground_utilities',
    obstacle_subtype: 'gas',
    distance_m: distance,
    citation: '743-ПП — газопровод',
    reason: '',
  },
});

const measured = (margin: number, distance: number): PlantingCheck => ({
  kind: 'measured',
  zone: zone(distance),
  margin,
  actual: margin + distance,
  planting: [0, 0],
  boundary: [margin, 0],
  obstacle: [margin + distance, 0],
});

const options = { focused: null, metersPerPixel: 0.01, crownRadiusM: 0.35 };

describe('dimensionLines', () => {
  test('измеренная проверка: запас, охранная зона, три засечки и две подписи', () => {
    const { features } = dimensionLines([measured(2.34, 1.5)], frame, options);

    const lines = features.filter(({ properties }) => properties.kind === 'line');
    expect(lines.map(({ properties }) => properties.part)).toEqual(['margin', 'setback']);
    const [margin] = lines;
    if (margin?.geometry.type !== 'LineString') throw new Error('ожидалась линия');
    const [start, end] = margin.geometry.coordinates.map(toMeters);
    expect(start?.[0]).toBeCloseTo(0, 6);
    expect(end?.[0]).toBeCloseTo(2.34, 6);

    expect(features.filter(({ properties }) => properties.kind === 'tick')).toHaveLength(3);
    expect(
      features
        .filter(({ properties }) => properties.kind === 'label')
        .map(({ properties }) => properties.text),
    ).toEqual(['2,3\u00A0м', '1,5\u00A0м']);
  });

  test('подпись — у своего отрезка: посередине, за краем кроны или сбоку от неё', () => {
    // Линия идёт по x: [вдоль, поперёк] в метрах для подписей запаса и охранной зоны.
    const labels = (
      margin: number,
      distance: number,
      crownRadiusM: number,
      metersPerPixel = 0.01,
    ) =>
      dimensionLines([measured(margin, distance)], frame, {
        ...options,
        crownRadiusM,
        metersPerPixel,
      })
        .features.filter(({ properties }) => properties.kind === 'label')
        .map(({ geometry }) => {
          if (geometry.type !== 'Point') throw new Error('ожидалась точка');
          return toMeters(geometry.coordinates);
        });
    const near = ([x, y]: LocalPoint | undefined = [NaN, NaN], [ex, ey]: LocalPoint) => {
      expect(x).toBeCloseTo(ex, 6);
      expect(y).toBeCloseTo(ey, 6);
    };

    // Кустарник, запас 4 м: середины отрезков дальше кроны 0,35 м + 20px · 0,01 м.
    const [margin, setback] = labels(4, 2, 0.35);
    near(margin, [2, 0]);
    near(setback, [5, 0]);

    // Дерево, запас 0,3 м: весь отрезок запаса под кроной — подпись сбоку, на 1,5 + 0,2 м от
    // ствола напротив середины; подпись охранной зоны — на её отрезке, у края кроны.
    const [besideMargin, shiftedSetback] = labels(0.3, 2, 1.5);
    near(besideMargin, [0.15, 1.7]);
    near(shiftedSetback, [1.7, 0]);

    // Мелкий масштаб, 6 px/м: запас кроны с подписью — 1,5 + 20/6 м. Оба отрезка под ним,
    // подписи — по разные стороны линии, вдоль — не дальше концов своих отрезков.
    const clearance = 1.5 + 20 / 6;
    const [marginSide, setbackSide] = labels(0.5, 0.7, 1.5, 1 / 6);
    near(marginSide, [0.25, clearance]);
    near(setbackSide, [0.85, -clearance]);
  });

  test('засечка поперёк линии: 0,6 м, на мелком масштабе — не короче 8 пикселей', () => {
    const tickLength = (metersPerPixel: number) => {
      const tick = dimensionLines([measured(2, 1)], frame, {
        ...options,
        metersPerPixel,
      }).features.find(({ properties }) => properties.kind === 'tick');
      if (tick?.geometry.type !== 'LineString') throw new Error('ожидалась засечка');
      const [[ax, ay] = [0, 0], [bx, by] = [0, 0]] = tick.geometry.coordinates.map(toMeters);
      // Линия идёт по x — засечка по y.
      expect(ax).toBeCloseTo(bx, 6);
      return Math.abs(by - ay);
    };

    expect(tickLength(0.01)).toBeCloseTo(0.6, 6);
    expect(tickLength(1)).toBeCloseTo(8, 6);
  });

  test('только до границы зоны — без охранной зоны', () => {
    const check: PlantingCheck = {
      kind: 'boundary',
      zone: zone(2),
      margin: 1.2,
      planting: [0, 0],
      boundary: [0, 1.2],
    };

    const parts = dimensionLines([check], frame, options).features.map(
      ({ properties }) => properties.part,
    );

    expect(new Set(parts)).toEqual(new Set(['margin']));
  });

  test('не больше трёх ближайших, «внутри зоны» и нулевой запас не рисуются', () => {
    const checks: PlantingCheck[] = [
      { kind: 'inside', zone: zone(1) },
      measured(0, 1),
      measured(1, 1),
      measured(2, 1),
      measured(3, 1),
      measured(4, 1),
    ];

    const drawn = new Set(
      dimensionLines(checks, frame, options).features.map(({ properties }) => properties.check),
    );

    expect([...drawn]).toEqual([2, 3, 4]);
  });

  test('ограничение в фокусе выделено, остальные бледнее', () => {
    const { features } = dimensionLines([measured(1, 1), measured(2, 1)], frame, {
      ...options,
      focused: 1,
    });

    expect(
      new Set(
        features.map(({ properties }) => `${String(properties.check)}:${properties.emphasis}`),
      ),
    ).toEqual(new Set(['0:dim', '1:focus']));
  });

  test('фокус на пункте без линии остальные не гасит', () => {
    const { features } = dimensionLines(
      [{ kind: 'inside', zone: zone(1) }, measured(1, 1)],
      frame,
      { ...options, focused: 0 },
    );

    expect(new Set(features.map(({ properties }) => properties.emphasis))).toEqual(
      new Set(['normal']),
    );
  });
});

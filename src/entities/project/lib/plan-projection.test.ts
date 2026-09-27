import { describe, expect, test } from 'vitest';

import { metersPerDegree } from '@/shared/lib/geodesy';

import {
  createPlanProjection,
  CROWN_RADIUS_M,
  crownRadiusPx,
  extentOf,
  isGeographic,
  pixelsPerMeterAtZoom,
} from './plan-projection';

describe('extentOf', () => {
  test('охват всех точек', () => {
    expect(
      extentOf([
        [3, 7],
        [-1, 2],
        [10, 4],
      ]),
    ).toEqual({ minX: -1, minY: 2, maxX: 10, maxY: 7 });
  });

  test('без точек охвата нет', () => {
    expect(extentOf([])).toBeNull();
  });
});

describe('createPlanProjection', () => {
  test('локальные метры: вписывание с полем 8% с каждой стороны, центрирование, север вверх', () => {
    // 60 × 20 м в холст 400 × 300: ограничивает ширина, 400 × 0,84 / 60 = 5,6 пикселя на метр.
    const { project, pixelsPerMeter } = createPlanProjection({
      extent: { minX: 0, minY: 0, maxX: 60, maxY: 20 },
      width: 400,
      height: 300,
      geographic: false,
    });

    expect(pixelsPerMeter).toBeCloseTo(5.6);
    const [left, top] = project([0, 20]);
    const [right, bottom] = project([60, 0]);
    expect(left).toBeCloseTo(32);
    expect(right).toBeCloseTo(368);
    expect(top).toBeCloseTo(150 - (20 * 5.6) / 2);
    expect(bottom).toBeCloseTo(150 + (20 * 5.6) / 2);
  });

  test('WGS84: долгота сжата по эллипсоиду, масштаб в метрах совпадает по осям', () => {
    const lat = 55.76;
    const degree = metersPerDegree(lat);
    const degLon = 60 / degree.lon;
    const degLat = 60 / degree.lat;
    // Квадрат 60 × 60 м в квадратном холсте должен остаться квадратом.
    const { project, pixelsPerMeter } = createPlanProjection({
      extent: { minX: 37.64, minY: lat - degLat / 2, maxX: 37.64 + degLon, maxY: lat + degLat / 2 },
      width: 100,
      height: 100,
      geographic: true,
    });

    const [left, top] = project([37.64, lat + degLat / 2]);
    const [right, bottom] = project([37.64 + degLon, lat - degLat / 2]);
    expect(right - left).toBeCloseTo(bottom - top);
    expect(pixelsPerMeter * 60).toBeCloseTo(right - left);
  });
});

test('isGeographic — по метке CRS бэкенда', () => {
  expect(isGeographic('local drawing coordinates, no geo-reference available')).toBe(false);
  expect(isGeographic('EPSG:4326')).toBe(true);
});

describe('crownRadiusPx', () => {
  test('радиус кроны в масштабе', () => {
    expect(crownRadiusPx(CROWN_RADIUS_M.tree, 10)).toBe(15);
    expect(crownRadiusPx(CROWN_RADIUS_M.shrub, 10)).toBeCloseTo(3.5);
  });

  test('на мелком масштабе — не меньше 1,5 пикселя', () => {
    expect(crownRadiusPx(CROWN_RADIUS_M.tree, 0.1)).toBe(1.5);
    expect(crownRadiusPx(CROWN_RADIUS_M.shrub, 0.1)).toBe(1.5);
  });
});

test('pixelsPerMeterAtZoom: на экваторе zoom 0 — весь мир в 512 пикселях', () => {
  expect(pixelsPerMeterAtZoom(0, 0) * 40_075_016.686).toBeCloseTo(512);
  expect(pixelsPerMeterAtZoom(18, 60)).toBeCloseTo(2 * pixelsPerMeterAtZoom(18, 0) * 2 ** 0, 6);
});

// Г2 → Г3: длина градуса — по эллипсоиду вместо 111 320 м × cos φ. Превью и радиусы крон
// в пикселях от этого почти не меняются.
test('переход на эллипсоид меняет масштаб превью меньше чем на 0,5 % по обеим осям', () => {
  for (const lat of [55.14, 55.76, 56.02]) {
    const extent = { minX: 37.6, minY: lat - 0.005, maxX: 37.61, maxY: lat + 0.005 };
    const { project, pixelsPerMeter } = createPlanProjection({
      extent,
      width: 400,
      height: 300,
      geographic: true,
    });
    const [x0, y0] = project([extent.minX, extent.minY]);
    const [x1, y1] = project([extent.maxX, extent.maxY]);
    // Прежняя формула: 111 320 м в градусе широты, долгота — с cos φ средней широты.
    const oldWidthM = 0.01 * 111_320 * Math.cos((lat * Math.PI) / 180);
    const oldHeightM = 0.01 * 111_320;
    expect(Math.abs((x1 - x0) / pixelsPerMeter / oldWidthM - 1)).toBeLessThan(0.005);
    expect(Math.abs((y0 - y1) / pixelsPerMeter / oldHeightM - 1)).toBeLessThan(0.005);
  }
});

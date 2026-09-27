import { describe, expect, test } from 'vitest';

import { enuToGeodetic, geodeticToEnu, vincentyInverse } from '@/shared/lib/geodesy';
import type { Placement } from '@/shared/lib/georeference';
import { sampleContour } from '@/shared/lib/test';

import {
  draggedAnchor,
  fitBounds,
  formatModelError,
  grabOffset,
  handlePosition,
  metersPerPixel,
  rotationAt,
  sectorFeature,
  thinOut,
} from './contour-geometry';

const ANCHOR = { lat: 55.7431, lon: 37.5908 };
const placement = (rotation = 0): Placement => ({
  source: sampleContour(),
  anchor: ANCHOR,
  rotation,
  scale: 1,
});
const at = (e: number, n: number) => {
  const { lat, lon } = enuToGeodetic({ e, n }, ANCHOR);
  return { lat, lon };
};

describe('поворот по ручке', () => {
  // rotation = −atan2(e, n): поворот против часовой — положительный.
  test.each([
    ['север', 0, 100, 0],
    ['восток', 100, 0, -90],
    ['запад', -100, 0, 90],
    ['северо-восток', 100, 100, -45],
  ])('ручка на %s — %d°', (_name, e, n, expected) => {
    expect(rotationAt(ANCHOR, at(e, n), false)).toBeCloseTo(expected, 6);
  });

  test('без Shift — свободно, с Shift — кратно 15°', () => {
    // 37° против часовой: ручка на северо-запад от опорной точки.
    const handle = at(-100 * Math.sin((37 * Math.PI) / 180), 100 * Math.cos((37 * Math.PI) / 180));
    expect(rotationAt(ANCHOR, handle, false)).toBeCloseTo(37, 6);
    expect(rotationAt(ANCHOR, handle, true)).toBe(30);
  });

  test('ручка — в сторону поворота, на 1,06 радиуса и не ближе 15 м', () => {
    const north = geodeticToEnu({ ...handlePosition(placement(0)), h: 0 }, ANCHOR);
    const radius = sampleContour().radius;
    expect(north.e).toBeCloseTo(0, 6);
    expect(north.n).toBeCloseTo(radius * 1.06, 3);
    expect(rotationAt(ANCHOR, handlePosition(placement(-120)), false)).toBeCloseTo(-120, 6);

    const tiny = { ...placement(), scale: 0.001 };
    expect(vincentyInverse(ANCHOR, handlePosition(tiny)).distance).toBeCloseTo(15, 3);
  });

  test('сектор — только когда угол изменился', () => {
    expect(sectorFeature(placement(0), 0).features).toHaveLength(0);
    expect(sectorFeature(placement(30), 0).features).toHaveLength(1);
  });
});

describe('перетаскивание', () => {
  test('смещение от курсора постоянное: курсор на 100 м к востоку — опорная точка тоже', () => {
    const cursor = at(-40, 25);
    const offset = grabOffset(ANCHOR, cursor);
    expect(draggedAnchor(offset, cursor).lat).toBeCloseTo(ANCHOR.lat, 10);

    // Точки курсора заданы в касательной плоскости, расстояние меряется по эллипсоиду:
    // на 100 м они расходятся на доли миллиметра.
    const moved = draggedAnchor(offset, at(60, 25));
    const { distance, azimuth } = vincentyInverse(ANCHOR, moved);
    expect(distance).toBeCloseTo(100, 2);
    expect(azimuth).toBeCloseTo(90, 1);
  });

  test('двадцать шагов по 5 м дают ровно 100 м: ошибка не копится', () => {
    const offset = grabOffset(ANCHOR, ANCHOR);
    let anchor = ANCHOR;
    for (let step = 1; step <= 20; step += 1) anchor = draggedAnchor(offset, at(step * 5, 0));
    expect(vincentyInverse(ANCHOR, anchor).distance).toBeCloseTo(100, 6);
  });
});

describe('упрощение для жеста', () => {
  test('контур меньше предела не меняется', () => {
    const { polygons } = sampleContour();
    expect(thinOut(polygons, 1000)).toBe(polygons);
  });

  test('крупный — прорежен до предела, кольца не короче трёх вершин', () => {
    const big = Array.from({ length: 50_000 }, (_, i) => ({ x: Math.cos(i), y: Math.sin(i) }));
    const small = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    const [thinned] = thinOut([[big, small]], 5000);
    expect(thinned?.[0]?.length).toBeLessThanOrEqual(5000);
    expect(thinned?.[1]).toBe(small);
  });
});

describe('вписывание', () => {
  test('рамка симметрична относительно опорной точки и включает ручку', () => {
    const [west, south, east, north] = fitBounds(placement(0));
    expect((west + east) / 2).toBeCloseTo(ANCHOR.lon, 12);
    expect((south + north) / 2).toBeCloseTo(ANCHOR.lat, 12);
    expect(north).toBeGreaterThanOrEqual(handlePosition(placement(0)).lat);
  });
});

test('метры на пиксель — по двум точкам карты, по эллипсоиду', () => {
  // «Карта» в 0,5 м на пиксель к востоку на широте опорной точки.
  const unproject = ([x]: [number, number]) => at(x * 0.5, 0);
  expect(metersPerPixel(unproject, [400, 300])).toBeCloseTo(0.5, 5);
});

test('погрешность модели: миллиметры для малых площадок', () => {
  expect(formatModelError(0.000001)).toBe('менее 0,01\u00A0мм');
  expect(formatModelError(0.00123)).toBe('1,23\u00A0мм');
  expect(formatModelError(2.5)).toBe('2,50\u00A0м');
});

import { describe, expect, test } from 'vitest';

import { siteProblem, siteSize, toBboxUser } from './site';

// Около Покровки: 0,006° долготы ≈ 377 м, 0,003° широты ≈ 334 м.
const POKROVKA = { west: 37.642, south: 55.758, east: 37.648, north: 55.761 };

describe('область участка', () => {
  test('bbox_user — [minx, miny, maxx, maxy] в lon/lat: долгота первой', () => {
    expect(toBboxUser(POKROVKA)).toEqual([37.642, 55.758, 37.648, 55.761]);
  });

  test('размер — в метрах, той же проекцией, что план', () => {
    const { width, height } = siteSize(POKROVKA);

    expect(width).toBeCloseTo(377, 0);
    expect(height).toBeCloseTo(334, 0);
    expect(siteProblem(POKROVKA, 'map')).toBeNull();
  });

  test.each([
    [
      'углы перепутаны',
      { ...POKROVKA, west: 37.649 },
      /^Юго-западный угол должен быть южнее и западнее/,
    ],
    ['вне Москвы', { west: 30.3, south: 59.9, east: 30.31, north: 59.91 }, /за пределы Москвы/],
    ['меньше 50 м', { ...POKROVKA, east: 37.6425, north: 55.7582 }, /^Область меньше 50/],
    ['больше 5 км', { ...POKROVKA, east: 37.75 }, /^Область больше 5/],
  ])('%s — отказ', (_, area, message) => {
    expect(siteProblem(area, 'manual')).toMatch(message);
  });

  test('совет зависит от способа ввода: масштаб карты или углы', () => {
    const large = { ...POKROVKA, east: 37.75 };

    expect(siteProblem(large, 'map')).toMatch(/Приблизьте карту/);
    expect(siteProblem(large, 'manual')).toMatch(/Сдвиньте углы/);
  });
});

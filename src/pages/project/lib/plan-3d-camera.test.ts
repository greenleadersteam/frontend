import { describe, expect, test } from 'vitest';

import { densestPoint, longAxisBearing, viewCamera } from './plan-3d-camera';

const row = (dLon: number, dLat: number): [number, number][] =>
  [0, 1, 2, 3, 4].map((step) => [37.6 + step * dLon, 55.75 + step * dLat]);

describe('ракурсы по охвату посадок', () => {
  test('длинная ось: запад—восток 90°, юг—север 0°, диагональ в метрах — 45°', () => {
    expect(longAxisBearing(row(0.001, 0))).toBeCloseTo(90);
    expect(Math.abs(longAxisBearing(row(0, 0.001)) % 180)).toBeCloseTo(0);
    // Диагональ в метрах: долгота растянута на 1 / cos(широты).
    const scale = Math.cos((55.75 * Math.PI) / 180);
    expect(longAxisBearing(row(0.001 / scale, 0.001))).toBeCloseTo(45, 0);
  });

  test('обзор и «вдоль участка» вписывают охват под 60°, «вдоль» — по длинной оси', () => {
    const street = row(0.001, 0);

    expect(viewCamera('overview', street)).toMatchObject({ kind: 'fit', pitch: 60, bearing: -20 });
    expect(viewCamera('along', street)).toMatchObject({ kind: 'fit', pitch: 60 });
  });

  test('пешеходный ракурс — 75° над самым плотным местом', () => {
    const crowd: [number, number][] = [
      ...row(0.001, 0),
      [37.6041, 55.75],
      [37.6042, 55.75],
      [37.6043, 55.75],
    ];
    const [lon] = densestPoint(crowd);

    expect(viewCamera('pedestrian', crowd)).toMatchObject({ kind: 'point', pitch: 75 });
    expect(lon).toBeGreaterThan(37.603);
  });
});

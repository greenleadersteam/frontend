import { describe, expect, test } from 'vitest';

import type { ExplanationEntry } from '../api/project-result-api';
import { drawingTransform } from './drawing-transform';

// Участок у Покровки: чертёж повёрнут на 12° и сдвинут; до WGS84 — длина градуса на широте
// участка, как у мока. На 80 м это совпадает с конформной проекцией до долей миллиметра.
const LAT0 = 55.7593;
const LON0 = 37.6452;
const radians = (LAT0 * Math.PI) / 180;
const perDegree = {
  lat: 111_132.954 - 559.822 * Math.cos(2 * radians) + 1.175 * Math.cos(4 * radians),
  lon: 111_412.84 * Math.cos(radians) - 93.5 * Math.cos(3 * radians),
};
const ANGLE = (12 * Math.PI) / 180;
const OFFSET = [-1500, 200];

const toLonLat = ([x = 0, y = 0]: readonly number[]): [number, number] => {
  const [dx, dy] = [x - (OFFSET[0] ?? 0), y - (OFFSET[1] ?? 0)];
  const east = dx * Math.cos(ANGLE) - dy * Math.sin(ANGLE);
  const north = dx * Math.sin(ANGLE) + dy * Math.cos(ANGLE);
  return [LON0 + east / perDegree.lon, LAT0 + north / perDegree.lat];
};

const DRAWING: [number, number][] = [
  [-1500, 200],
  [-1450, 210],
  [-1440, 260],
  [-1490, 270],
  [-1470, 235],
];

const plantings = DRAWING.map((point, index) => ({
  geometry: { coordinates: toLonLat(point) },
  properties: { id: `T-${String(index)}`, origin: 'auto' as const, moved_from: null },
}));

const entries = (points: [number, number][]) =>
  new Map(
    points.map(([x, y], index): [string, ExplanationEntry] => {
      const id = `T-${String(index)}`;
      return [id, { id, plant_type: 'tree', rule_id: 'R', rule_name_ru: null, x, y }];
    }),
  );

describe('drawingTransform', () => {
  test('без геопривязки данные уже чертёжные', () => {
    expect(drawingTransform(plantings, entries(DRAWING), false)).toEqual({ kind: 'identity' });
  });

  test('подобие по неизменённым посадкам возвращает точку чертежа с точностью до сантиметра', () => {
    const transform = drawingTransform(plantings, entries(DRAWING), true);
    if (transform.kind !== 'fitted') throw new Error(transform.kind);

    expect(transform.rms).toBeLessThan(0.001);
    expect(transform.pairs).toBe(5);
    const [x, y] = transform.toDrawing(toLonLat([-1462.5, 244.25]));
    expect(x).toBeCloseTo(-1462.5, 2);
    expect(y).toBeCloseTo(244.25, 2);
  });

  test('по двум парам подобие решается точно и не проверяется — слой не собирается', () => {
    expect(drawingTransform(plantings.slice(0, 2), entries(DRAWING), true)).toEqual({
      kind: 'insufficient',
    });
  });

  test('перемещённые и добавленные в подгонку не входят', () => {
    const moved = plantings.map((planting, index) =>
      index < 4
        ? { ...planting, properties: { ...planting.properties, origin: 'manual' as const } }
        : planting,
    );
    expect(drawingTransform(moved, entries(DRAWING), true)).toEqual({ kind: 'insufficient' });
  });

  test('сервер применил не подобие — RMS больше 1 см, слой не собирается', () => {
    const bent = DRAWING.map(([x, y], index): [number, number] =>
      index === 4 ? [x + 0.1, y] : [x, y],
    );
    const transform = drawingTransform(plantings, entries(bent), true);

    expect(transform.kind).toBe('mismatch');
    if (transform.kind === 'mismatch') expect(transform.rms).toBeGreaterThan(0.01);
  });
});

import { expect, it } from 'vitest';

import type { Contour } from '@/shared/lib/contour';
import { buildContour } from '@/shared/lib/contour';

// Тестовый участок прототипа (../geojson/js/sample.js): Г-образный участок 900 × 620 м
// с внутренним кольцом. Координаты — метры условной местной системы, как в файле от проектировщика.
export const GEOREFERENCE_SAMPLE = {
  name: 'Участок-образец.geojson',
  geojson: {
    type: 'Feature',
    properties: { name: 'Граница проектирования (образец)' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [2180000, 476000],
          [2180900, 476000],
          [2180900, 476250],
          [2180380, 476250],
          [2180380, 476620],
          [2180000, 476620],
          [2180000, 476000],
        ],
        [
          [2180120, 476080],
          [2180320, 476080],
          [2180320, 476190],
          [2180120, 476190],
          [2180120, 476080],
        ],
      ],
    },
  },
};

export function contourOf(value: unknown, name?: string): Contour {
  const parsed = buildContour(value, name);
  if (!parsed.ok) throw new Error(`контур не разобран: ${parsed.error.kind}`);
  return parsed.contour;
}

export const sampleContour = (): Contour =>
  contourOf(GEOREFERENCE_SAMPLE.geojson, GEOREFERENCE_SAMPLE.name);

// Проверки прототипа ../geojson/tests.html переносятся группами, и у каждой группы в прототипе
// есть ожидаемое число строк: если проверка потерялась при переносе, это видно по счёту,
// а не по зелёному прогону.
export function portedGroup(expected: number): { check: (name: string, fn: () => void) => void } {
  const names: string[] = [];
  it(`в группе ${String(expected)} проверок`, () => {
    expect(names).toHaveLength(expected);
  });
  return {
    check: (name, fn) => {
      names.push(name);
      it(name, fn);
    },
  };
}

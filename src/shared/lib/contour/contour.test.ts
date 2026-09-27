import { describe, expect, it } from 'vitest';

import a from './__fixtures__/участок-А-простой.geojson?raw';
import b from './__fixtures__/участок-Б-с-исключением.geojson?raw';
import c from './__fixtures__/участок-В-два-контура.geojson?raw';
import g from './__fixtures__/участок-Г-миллиметры.geojson?raw';
import d from './__fixtures__/участок-Д-крупный.geojson?raw';
import type { Contour } from './contour';
import { parseContour } from './contour';
import { diagnose, millimetreHint } from './diagnostics';

// Примеры прототипа ../geojson/examples. Его проверки читать файлы не могли (file://) и брали
// габариты константами; здесь те же файлы проходят настоящий разбор.
function parsed(source: string, name: string): Contour {
  const result = parseContour(source, name);
  if (!result.ok) throw new Error(result.error.kind);
  return result.contour;
}

describe('примеры участков', () => {
  it.each([
    ['А, простой', a, { polygons: 1, rings: 1, vertices: 11 }],
    ['Б, с исключением', b, { polygons: 1, rings: 2, vertices: 15 }],
    ['В, два контура', c, { polygons: 2, rings: 3, vertices: 20 }],
    ['Г, миллиметры', g, { polygons: 1, rings: 1, vertices: 11 }],
    ['Д, крупный', d, { polygons: 1, rings: 1, vertices: 240 }],
  ])('%s: разбор без замыкающих вершин', (name, source, counts) => {
    expect(parsed(source, name).counts).toEqual(counts);
  });

  it('А совпадает с кольцом, которое проверка устойчивости к клику держит константой', () => {
    expect(parsed(a, 'А').polygons[0]?.[0]?.map(({ x, y }) => [x, y])).toEqual([
      [2245600, 476200],
      [2245918, 476200],
      [2245918, 476296],
      [2245842, 476296],
      [2245842, 476358],
      [2245796, 476362],
      [2245796, 476441],
      [2245684, 476441],
      [2245684, 476398],
      [2245637, 476391],
      [2245600, 476348],
    ]);
  });

  it('Г в миллиметрах: подсказка про участок 318 × 241 м, других предупреждений нет', () => {
    const contour = parsed(g, 'Г');
    expect(millimetreHint(contour)).toMatchObject({ mmWidth: 318, mmHeight: 241 });
    expect(diagnose(contour)).toEqual([]);
  });

  it('Д в метрах, 2,7 км: ни подсказки, ни предупреждений', () => {
    const contour = parsed(d, 'Д');
    expect(contour.bbox.width).toBeCloseTo(2660.9, 6);
    expect(contour.bbox.height).toBeCloseTo(2575.974, 6);
    expect(millimetreHint(contour)).toBeNull();
    expect(diagnose(contour)).toEqual([]);
  });
});

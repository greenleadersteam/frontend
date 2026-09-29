import { describe, expect, test } from 'vitest';

import type { DxfComparison, LayerComparison } from '@/shared/lib/dxf-compare';

import { differenceLine, differingLayers, dxfVerdict } from './dxf-check';

const layer = (extra: Partial<LayerComparison> & Pick<LayerComparison, 'name'>) => ({
  source: 10,
  result: 10,
  status: 'same' as const,
  missing: 0,
  extra: 0,
  ...extra,
});

const compared = (layers: LayerComparison[]): DxfComparison => ({
  kind: 'compared',
  sourceVersion: 'AC1015',
  resultVersion: 'AC1015',
  layers,
});

describe('вердикт проверки чертежа', () => {
  test('добавленный слой результата не портит вердикт: сущности считаются по исходным слоям', () => {
    const comparison = compared([
      layer({ name: 'Газон', source: 1, result: 1 }),
      layer({ name: 'GREENING_PROPOSED', source: 0, result: 38, status: 'added', extra: 38 }),
    ]);

    expect(dxfVerdict(comparison)).toEqual({
      kind: 'unchanged',
      text: 'Исходные слои не изменены. Совпадение: 1 слой, 1 сущность.',
    });
  });

  test('изменённый и удалённый слои — в вердикте и строками различий', () => {
    const comparison = compared([
      layer({ name: 'Газон' }),
      layer({ name: 'ДОРОГИ', result: 9, status: 'changed', missing: 2, extra: 1 }),
      layer({ name: 'Сети', result: 0, status: 'removed', missing: 10 }),
    ]);

    expect(dxfVerdict(comparison)).toEqual({
      kind: 'changed',
      text: 'Исходные слои изменены: 2 слоя из 3.',
    });
    expect(differingLayers(comparison).map(differenceLine)).toEqual([
      'Слой «ДОРОГИ»: было 10 сущностей, стало 9; из исходных не найдено 2, новых или изменённых 1.',
      'Слой «Сети» удалён: было 10 сущностей.',
    ]);
  });

  test('пустой исходный файл или сам результат вместо исходного — отказ, а не зелёный вердикт', () => {
    expect(dxfVerdict(compared([])).kind).toBe('refused');
    expect(dxfVerdict(compared([layer({ name: 'GREENING_PROPOSED' })]))).toMatchObject({
      kind: 'refused',
    });
  });

  test('результат без посадок — исходные слои не изменены, а не отказ', () => {
    expect(dxfVerdict(compared([layer({ name: 'Газон', source: 2, result: 2 })]))).toMatchObject({
      kind: 'unchanged',
    });
  });

  test('двоичный DXF — честный отказ, без вердикта о слоях', () => {
    const verdict = dxfVerdict({ kind: 'binary', file: 'source' });
    expect(verdict.kind).toBe('refused');
    expect(verdict.text).toContain('двоичный DXF');
  });
});

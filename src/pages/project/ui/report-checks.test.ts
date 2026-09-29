import { describe, expect, test } from 'vitest';

import type { ReportCheck, ReportPlanting } from '../model/report';
import { CROWN_NOTE } from './check-item';
import { checksSheet } from './report-checks';

type Common = Omit<ReportCheck, 'kind' | 'actual'>;

const COMMON: Common = {
  object: 'Газопровод',
  category: 'underground_utilities',
  subtype: 'gas',
  required: 1.5,
  margin: 8.3123,
  violated: false,
  withinTolerance: false,
  basis: { basis: 'regulation' },
  citation: '743-ПП — газопровод',
  norm: null,
};

const check = (extra: Partial<Common> = {}, actual = 9.8123): ReportCheck => ({
  kind: 'object',
  actual,
  ...COMMON,
  ...extra,
});

const measured = (actual: number, extra: Partial<Common>): ReportCheck => ({
  kind: 'measured',
  actual,
  ...COMMON,
  ...extra,
});

const withoutDistance = (kind: 'boundary' | 'inside', extra: Partial<Common>): ReportCheck => ({
  kind,
  actual: null,
  ...COMMON,
  ...extra,
});

const planting = (id: string, checks: ReportCheck[], extra: Partial<ReportPlanting> = {}) => ({
  id,
  plantType: 'tree' as const,
  ruleName: null,
  changed: false,
  status: 'allowed' as const,
  crownOverNote: false,
  checks,
  ...extra,
});

describe('все проверки для Excel', () => {
  test('строка — одна проверка; расстояния — числами с точностью таблицы', () => {
    const sheet = checksSheet([
      planting('TREE-1', [
        check({}),
        measured(1.26, { object: 'Бортовой камень', required: 2, violated: true }),
      ]),
    ]);

    expect(sheet.rows).toEqual([
      ['TREE-1', 'Дерево', 'Газопровод', 9.81, 1.5, '743-ПП — газопровод', 'Выполнено', null],
      ['TREE-1', 'Дерево', 'Бортовой камень', 1.3, 2, '743-ПП — газопровод', 'Нарушено', null],
    ]);
  });

  test('без фактического расстояния — пусто и объяснение в примечании', () => {
    const sheet = checksSheet([
      planting('TREE-1', [
        withoutDistance('boundary', { margin: 0.44 }),
        withoutDistance('inside', { margin: -Infinity, violated: true }),
      ]),
    ]);

    expect(sheet.rows.map((row) => [row[3], row[7]])).toEqual([
      [null, 'до границы зоны 0,4 м'],
      [null, 'внутри зоны запрета'],
    ]);
  });

  test('значение сервиса и примечание о кроне — как в отчёте', () => {
    const sheet = checksSheet([
      planting(
        'TREE-1',
        [check({}), check({ basis: { basis: 'service_default', reason: 'нормы нет' } })],
        { crownOverNote: true },
      ),
    ]);

    expect(sheet.rows.map((row) => [row[5], row[6], row[7]])).toEqual([
      ['743-ПП — газопровод', 'Выполнено', CROWN_NOTE],
      ['значение сервиса', 'Значение сервиса', null],
    ]);
  });

  test('посадка без проверок — строкой; итоги — посадки, проверки, нарушения', () => {
    const sheet = checksSheet([
      planting('SHRUB-2', [], { plantType: 'shrub' }),
      planting('TREE-1', [check({ violated: true }), check({})]),
    ]);

    expect(sheet.rows[0]).toEqual([
      'SHRUB-2',
      'Кустарник',
      'Рядом нет ограничений из проверяемых сервисом',
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(sheet.totals).toEqual([
      ['Итого посадок', 2],
      ['Итого проверок', 2],
      ['Нарушено', 1],
    ]);
  });
});

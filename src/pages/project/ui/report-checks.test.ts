import { describe, expect, test } from 'vitest';

import type { ReportCheck, ReportPlanting } from '../model/report';
import { CROWN_NOTE } from './check-item';
import { checksSheet, shortBasis } from './report-checks';

type Common = Omit<ReportCheck, 'kind' | 'actual'>;

const COMMON: Common = {
  object: 'Газопровод',
  category: 'underground_utilities',
  subtype: 'gas',
  required: 1.5,
  margin: 8.3123,
  violated: false,
  withinTolerance: false,
  basis: { basis: 'regulation', verified: null },
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

  test('пункт акта на «Сервере»: сверенная норма — полный пункт, значение сервиса — без пункта, чужой citation — как есть', () => {
    const verified = {
      act: 'ПП Москвы №\u00A0743-ПП',
      clause: 'прил. 1, п. 3.6.3, табл. 3.6.1',
      actMark: '743-ПП',
      table: 'табл. 3.6.1',
      source: 'https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/',
    };
    const cable = {
      object: 'Силовой кабель',
      basis: { basis: 'regulation' as const, verified },
      citation: '743-ПП, табл. 3.6.1 — силовой кабель',
    };
    const sheet = checksSheet([
      planting('TREE-1', [
        check(cable),
        check({
          basis: { basis: 'service_default', reason: 'нормы нет' },
          citation: cable.citation,
        }),
        check({ ...cable, citation: 'МГСН 1.02-02, табл. 9.1 — проезды' }),
        check({
          ...cable,
          citation: '743-ПП, табл. 3.6.1; СП 42.13330.2016, табл. 9.1 — край тротуара',
        }),
      ]),
    ]);

    expect(sheet.rows.map((row) => row[5])).toEqual([
      'ПП Москвы №\u00A0743-ПП, прил. 1, п. 3.6.3, табл. 3.6.1 (пункт — по сверке с текстом акта)',
      'значение сервиса',
      'МГСН 1.02-02, табл. 9.1 — проезды',
      'ПП Москвы №\u00A0743-ПП, прил. 1, п. 3.6.3, табл. 3.6.1; СП 42.13330.2016, табл. 9.1 (пункт — по сверке с текстом акта)',
    ]);
    // В таблице отчёта основание короткое: пункт, акт — в «Применённых нормах».
    expect(shortBasis(check(cable))).toBe('прил. 1, п. 3.6.3, табл. 3.6.1 (по сверке)');
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

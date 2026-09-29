import { describe, expect, test } from 'vitest';

import {
  appliedNorms,
  defaultReportSelection,
  type ReportCheck,
  type ReportPlanting,
} from './report';

// Проверка до объекта; меняются только признаки результата и основание.
type CheckExtra = Partial<Pick<ReportCheck, 'violated' | 'withinTolerance' | 'basis'>>;

const check = (subtype: string, margin: number, extra: CheckExtra = {}): ReportCheck => ({
  kind: 'object',
  object: subtype,
  category: 'underground_utilities',
  subtype,
  actual: 2 + margin,
  required: 2,
  margin,
  violated: false,
  withinTolerance: false,
  basis: { basis: 'regulation', verified: null },
  citation: `743-ПП — ${subtype}`,
  norm: null,
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

describe('проверки по посадкам в отчёте', () => {
  test('по умолчанию: правки, нарушения, предупреждения и по три ближайших к каждой сети', () => {
    const plantings = [
      planting('far-1', [check('gas', 9)]),
      planting('edited', [check('gas', 8)], { changed: true }),
      planting('violated', [check('gas', -0.5, { violated: true })]),
      planting('tolerance', [check('water', 5, { withinTolerance: true })]),
      planting('crown', [check('heat', 7)], { crownOverNote: true }),
      planting('near-1', [check('gas', 0.1)]),
      planting('near-2', [check('gas', 0.2)]),
      planting('far-2', [check('gas', 3)]),
      planting('outside', [], { status: 'rejected' }),
    ];

    expect(defaultReportSelection(plantings).map(({ id }) => id)).toEqual([
      'edited',
      'violated',
      // Единственная посадка у водопровода и у тепловой сети — и так в тройке ближайших.
      'tolerance',
      'crown',
      'near-1',
      'near-2',
      'outside',
    ]);
  });

  test('крона больше 5 м — предупреждение только у нормы акта, не у значения сервиса', () => {
    const service = planting(
      'crown-service',
      [check('other_utility', 9, { basis: { basis: 'service_default', reason: 'нет' } })],
      { crownOverNote: true },
    );
    const others = ['a', 'b', 'c'].map((id) => planting(id, [check('other_utility', 1)]));

    expect(defaultReportSelection([service, ...others]).map(({ id }) => id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('применённые нормы', () => {
  test('каждая пара «объект, тип посадки, отступ» — один раз, только сработавшие', () => {
    const norms = appliedNorms([
      planting('1', [check('gas', 1), check('water', 2)]),
      planting('2', [check('gas', 3)]),
      planting('3', [check('gas', 3)], { plantType: 'shrub' }),
    ]);

    expect(norms.map(({ object, plantType }) => [object, plantType])).toEqual([
      ['gas', 'tree'],
      ['gas', 'shrub'],
      ['water', 'tree'],
    ]);
  });
});

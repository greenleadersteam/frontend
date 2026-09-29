import { describe, expect, test } from 'vitest';

import type { RegisterRow } from './register-csv';
import { registerSheet, speciesSheet } from './register-xlsx';
import type { SpeciesRow } from './species-register';

const row = (overrides: Partial<RegisterRow>): RegisterRow => ({
  number: 1,
  id: 'TREE_ROW_CURB-00001',
  plantType: 'tree',
  ruleName: 'Рядовая/аллейная посадка вдоль борта',
  status: 'allowed',
  source: 'service',
  changed: false,
  lat: 55.75934567,
  lon: 37.64521234,
  x: -1499.2567,
  y: 202.274,
  ...overrides,
});

describe('ведомость посадок для Excel', () => {
  test('координаты — числами, с точностью таблицы; пустые — пустыми ячейками', () => {
    const sheet = registerSheet(
      [
        row({}),
        row({ number: 2, id: 'SHRUB-2', plantType: 'shrub', ruleName: null, x: null, y: null }),
      ],
      false,
    );

    expect(sheet.header).toEqual([
      '№',
      'Идентификатор',
      'Тип',
      'Правило посадки',
      'Широта',
      'Долгота',
      'X чертежа, м',
      'Y чертежа, м',
    ]);
    expect(sheet.rows[0]).toEqual([
      1,
      'TREE_ROW_CURB-00001',
      'Дерево',
      'Рядовая/аллейная посадка вдоль борта',
      55.759346,
      37.645212,
      -1499.26,
      202.27,
    ]);
    expect(sheet.rows[1]?.slice(3)).toEqual([null, 55.759346, 37.645212, null, null]);
  });

  test('с правками — статус и источник, как в CSV', () => {
    const sheet = registerSheet([row({ status: 'forbidden', source: 'moved' })], true);

    expect(sheet.header.slice(4, 6)).toEqual(['Статус', 'Источник']);
    expect(sheet.rows[0]?.slice(4, 6)).toEqual(['Нарушает норму', 'перемещена']);
  });

  test('итоги по типам: подпись и число рядом', () => {
    const sheet = registerSheet(
      [row({}), row({ number: 2, plantType: 'shrub' }), row({ number: 3, plantType: 'shrub' })],
      false,
    );

    expect(sheet.totals).toEqual([
      [null, 'Итого деревьев', 1],
      [null, 'Итого кустарников', 2],
    ]);
  });
});

describe('ведомость озеленения для Excel', () => {
  test('количество — числом, итоги по типам в той же колонке', () => {
    const rows: SpeciesRow[] = [
      {
        key: 'species|1',
        nameRu: 'Липа мелколистная',
        nameLat: 'Tilia cordata',
        plantType: 'tree',
        count: 3,
        note: '',
      },
      {
        key: 'rule|shrub|7',
        nameRu: 'Живая изгородь',
        nameLat: null,
        plantType: 'shrub',
        count: 9,
        note: 'Порода не определена сервисом',
      },
    ];

    const sheet = speciesSheet(rows);

    expect(sheet.rows).toEqual([
      [1, 'Липа мелколистная', 'Tilia cordata', 'Дерево', 3, ''],
      [2, 'Живая изгородь', null, 'Кустарник', 9, 'Порода не определена сервисом'],
    ]);
    expect(sheet.totals).toEqual([
      [null, 'Итого деревьев', null, null, 3, null],
      [null, 'Итого кустарников', null, null, 9, null],
    ]);
  });
});

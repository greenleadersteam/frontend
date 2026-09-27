import { describe, expect, test } from 'vitest';

import type { ExplanationEntry } from '@/entities/project';
import type { FinalPlanting } from '@/features/edit-plantings';

import { registerCsv, type RegisterRow, registerRows } from './register-csv';

const service = { origin: 'auto' as const, moved_from: null, species_changed: false };

const planting: FinalPlanting = {
  type: 'FeatureCollection',
  metadata: { crs: 'EPSG:4326 (WGS84 lon/lat)' },
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [37.6452123, 55.7593456] },
      properties: {
        id: 'TREE_ROW_CURB-00001',
        plant_type: 'tree',
        rule_id: 'TREE_ROW_CURB',
        ...service,
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [37.646, 55.76] },
      properties: {
        id: 'SHRUB_FILL_LAWN-00002',
        plant_type: 'shrub',
        rule_id: 'SHRUB_FILL_LAWN',
        ...service,
      },
    },
  ],
};

const explanation = new Map<string, ExplanationEntry>([
  [
    'TREE_ROW_CURB-00001',
    {
      id: 'TREE_ROW_CURB-00001',
      plant_type: 'tree',
      rule_id: 'TREE_ROW_CURB',
      rule_name_ru: 'Рядовая/аллейная посадка вдоль борта',
      x: -1499.255,
      y: 202.27,
    },
  ],
]);

const lines = (csv: string) => csv.split('\r\n');

describe('registerRows', () => {
  test('номер, тип, правило и координаты из /planting и /explanation', () => {
    expect(registerRows(planting, explanation, true, new Map())).toEqual([
      {
        number: 1,
        id: 'TREE_ROW_CURB-00001',
        plantType: 'tree',
        ruleName: 'Рядовая/аллейная посадка вдоль борта',
        status: 'allowed',
        source: 'service',
        changed: false,
        lat: 55.7593456,
        lon: 37.6452123,
        x: -1499.255,
        y: 202.27,
      },
      {
        number: 2,
        id: 'SHRUB_FILL_LAWN-00002',
        plantType: 'shrub',
        ruleName: null,
        status: 'allowed',
        source: 'service',
        changed: false,
        lat: 55.76,
        lon: 37.646,
        x: null,
        y: null,
      },
    ]);
  });

  test('правки: статус, источник; координаты чертежа у правленых — свои или неизвестны', () => {
    const [tree] = planting.features;
    if (tree === undefined) throw new Error('нет посадки');
    const edited: FinalPlanting = {
      ...planting,
      features: [
        {
          ...tree,
          geometry: { type: 'Point', coordinates: [-1497, 204] },
          properties: { ...tree.properties, moved_from: [-1499.255, 202.27] },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-1480, 210] },
          properties: {
            id: 'manual-1',
            plant_type: 'shrub',
            rule_id: 'manual',
            origin: 'manual',
            moved_from: null,
            species_changed: false,
          },
        },
      ],
    };
    const statuses = new Map([['TREE_ROW_CURB-00001', 'forbidden' as const]]);
    const [, shrub] = planting.features;
    if (shrub === undefined) throw new Error('нет посадки');
    edited.features.push({
      ...shrub,
      properties: { ...shrub.properties, species_changed: true },
    });

    expect(registerRows(edited, explanation, false, statuses)).toMatchObject([
      { status: 'forbidden', source: 'moved', changed: true, x: -1497, y: 204 },
      { status: 'allowed', source: 'added', changed: true, x: -1480, y: 210 },
      // Смена породы — правка, хотя посадка по-прежнему от сервиса.
      { status: 'allowed', source: 'service', changed: true },
    ]);
    // С геопривязкой /explanation хранит координаты чертежа до правки: их не показываем.
    expect(registerRows(edited, explanation, true, statuses)[0]).toMatchObject({
      x: null,
      y: null,
    });
  });

  test('без геопривязки широты и долготы нет', () => {
    const [row] = registerRows(planting, explanation, false, new Map());
    expect(row).toMatchObject({ lat: null, lon: null, x: -1499.255 });
  });
});

describe('registerCsv', () => {
  const csv = registerCsv(registerRows(planting, explanation, true, new Map()), true);

  test('UTF-8 с BOM, разделитель «;», строки через CRLF', () => {
    expect(
      csv.startsWith('\uFEFF№;Идентификатор;Тип;Правило посадки;Статус;Источник;Широта;Долгота;'),
    ).toBe(true);
    expect(lines(csv)).toHaveLength(4);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  test('без правок — без колонок «Статус» и «Источник», как в таблице', () => {
    const plain = registerCsv(registerRows(planting, explanation, true, new Map()), false);

    expect(lines(plain)[0]).toBe(
      '\uFEFF№;Идентификатор;Тип;Правило посадки;Широта;Долгота;X чертежа, м;Y чертежа, м',
    );
    expect(lines(plain)[2]).toBe('2;SHRUB_FILL_LAWN-00002;Кустарник;;55,760000;37,646000;;');
  });

  test('десятичная запятая, 6 знаков у WGS84 и 2 у чертежа, пустые ячейки без значения', () => {
    expect(lines(csv)[1]).toBe(
      '1;TREE_ROW_CURB-00001;Дерево;Рядовая/аллейная посадка вдоль борта;Соответствует нормам;сервис;55,759346;37,645212;-1499,26;202,27',
    );
    expect(lines(csv)[2]).toBe(
      '2;SHRUB_FILL_LAWN-00002;Кустарник;;Соответствует нормам;сервис;55,760000;37,646000;;',
    );
  });

  test('экранирование по RFC 4180: кавычки, разделитель, перевод строки', () => {
    const row = (ruleName: string): RegisterRow => ({
      number: 1,
      id: 'X-1',
      plantType: 'tree',
      ruleName,
      status: 'allowed',
      source: 'service',
      changed: false,
      lat: null,
      lon: null,
      x: null,
      y: null,
    });

    expect(lines(registerCsv([row('Посадка «у борта»; ряд "А"')], true))[1]).toBe(
      '1;X-1;Дерево;"Посадка «у борта»; ряд ""А""";Соответствует нормам;сервис',
    );
    expect(registerCsv([row('две\nстроки')], true)).toContain('"две\nстроки"');
  });

  test.each(['=HYPERLINK("http://x")', '+1', '-1', '@SUM(A1)', '\tTAB', '\rCR'])(
    'значение %j не исполняется как формула',
    (ruleName) => {
      const row: RegisterRow = {
        number: 1,
        id: 'X-1',
        plantType: 'tree',
        ruleName,
        status: 'allowed',
        source: 'service',
        changed: false,
        lat: null,
        lon: null,
        x: null,
        y: null,
      };
      const cell =
        lines(registerCsv([row], true))[1]
          ?.split(';')
          .slice(3, -2)
          .join(';') ?? '';

      expect(cell.replace(/^"/, '').startsWith("'")).toBe(true);
    },
  );
});

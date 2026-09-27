import { describe, expect, test } from 'vitest';

import type { ExplanationEntry, PlantingFeatureCollection } from '@/entities/project';

import { registerCsv, type RegisterRow, registerRows } from './register-csv';

const planting: PlantingFeatureCollection = {
  type: 'FeatureCollection',
  metadata: { crs: 'EPSG:4326 (WGS84 lon/lat)' },
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [37.6452123, 55.7593456] },
      properties: { id: 'TREE_ROW_CURB-00001', plant_type: 'tree', rule_id: 'TREE_ROW_CURB' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [37.646, 55.76] },
      properties: { id: 'SHRUB_FILL_LAWN-00002', plant_type: 'shrub', rule_id: 'SHRUB_FILL_LAWN' },
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
    expect(registerRows(planting, explanation, true)).toEqual([
      {
        number: 1,
        id: 'TREE_ROW_CURB-00001',
        plantType: 'tree',
        ruleName: 'Рядовая/аллейная посадка вдоль борта',
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
        lat: 55.76,
        lon: 37.646,
        x: null,
        y: null,
      },
    ]);
  });

  test('без геопривязки широты и долготы нет', () => {
    const [row] = registerRows(planting, explanation, false);
    expect(row).toMatchObject({ lat: null, lon: null, x: -1499.255 });
  });
});

describe('registerCsv', () => {
  const csv = registerCsv(registerRows(planting, explanation, true));

  test('UTF-8 с BOM, разделитель «;», строки через CRLF', () => {
    expect(csv.startsWith('\uFEFF№;Идентификатор;Тип;Правило посадки;Широта;Долгота;')).toBe(true);
    expect(lines(csv)).toHaveLength(4);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  test('десятичная запятая, 6 знаков у WGS84 и 2 у чертежа, пустые ячейки без значения', () => {
    expect(lines(csv)[1]).toBe(
      '1;TREE_ROW_CURB-00001;Дерево;Рядовая/аллейная посадка вдоль борта;55,759346;37,645212;-1499,26;202,27',
    );
    expect(lines(csv)[2]).toBe('2;SHRUB_FILL_LAWN-00002;Кустарник;;55,760000;37,646000;;');
  });

  test('экранирование по RFC 4180: кавычки, разделитель, перевод строки', () => {
    const row = (ruleName: string): RegisterRow => ({
      number: 1,
      id: 'X-1',
      plantType: 'tree',
      ruleName,
      lat: null,
      lon: null,
      x: null,
      y: null,
    });

    expect(lines(registerCsv([row('Посадка «у борта»; ряд "А"')]))[1]).toBe(
      '1;X-1;Дерево;"Посадка «у борта»; ряд ""А"""',
    );
    expect(registerCsv([row('две\nстроки')])).toContain('"две\nстроки"');
  });

  test.each(['=HYPERLINK("http://x")', '+1', '-1', '@SUM(A1)', '\tTAB', '\rCR'])(
    'значение %j не исполняется как формула',
    (ruleName) => {
      const row: RegisterRow = {
        number: 1,
        id: 'X-1',
        plantType: 'tree',
        ruleName,
        lat: null,
        lon: null,
        x: null,
        y: null,
      };
      const cell =
        lines(registerCsv([row]))[1]
          ?.split(';')
          .slice(3)
          .join(';') ?? '';

      expect(cell.replace(/^"/, '').startsWith("'")).toBe(true);
    },
  );
});

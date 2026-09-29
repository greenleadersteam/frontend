import { describe, expect, test } from 'vitest';

import { type DxfPlanting, plantingLayerDxf } from './planting-dxf';

// Разбор DXF как у читателей формата: построчно, пары «код — значение».
function parsePairs(dxf: string): [number, string][] {
  const lines = dxf.split('\r\n');
  const result: [number, string][] = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    result.push([Number(lines[index]), lines[index + 1] ?? '']);
  }
  return result;
}

type Entity = { type: string; pairs: [number, string][] };

// Сущности секции ENTITIES: от «0 <тип>» до следующего «0».
function entitiesOf(pairs: [number, string][]): Entity[] {
  const start = pairs.findIndex(
    ([code, value], index) =>
      code === 2 && value === 'ENTITIES' && pairs[index - 1]?.[1] === 'SECTION',
  );
  const entities: Entity[] = [];
  for (const [code, value] of pairs.slice(start + 1)) {
    if (code === 0) {
      if (value === 'ENDSEC') break;
      entities.push({ type: value, pairs: [] });
    } else {
      entities.at(-1)?.pairs.push([code, value]);
    }
  }
  return entities;
}

const values = (entity: Entity, code: number) =>
  entity.pairs.filter(([pairCode]) => pairCode === code).map(([, value]) => value);

const PLANTINGS: DxfPlanting[] = [
  {
    x: -1499.255,
    y: 202.27,
    plantType: 'tree',
    ruleId: 'TREE_ROW_CURB',
    id: 'TREE_ROW_CURB-00001',
    origin: 'auto',
    status: 'allowed',
    speciesId: 'sorbus_aucuparia',
  },
  {
    x: -1480,
    y: 210.5,
    plantType: 'shrub',
    ruleId: null,
    id: 'manual-1',
    origin: 'manual',
    status: 'rejected',
    speciesId: null,
  },
];

describe('plantingLayerDxf', () => {
  const dxf = plantingLayerDxf(PLANTINGS);
  const pairs = parsePairs(dxf);

  test('R12: заголовок с версией и метрами, секции по порядку, конец файла', () => {
    expect(pairs.slice(0, 8)).toEqual([
      [0, 'SECTION'],
      [2, 'HEADER'],
      [9, '$ACADVER'],
      [1, 'AC1009'],
      [9, '$INSUNITS'],
      [70, '6'],
      [0, 'ENDSEC'],
      [0, 'SECTION'],
    ]);
    const sections = pairs.filter(
      ([code], index) => code === 2 && pairs[index - 1]?.[1] === 'SECTION',
    );
    expect(sections.map(([, value]) => value)).toEqual(['HEADER', 'TABLES', 'ENTITIES']);
    expect(pairs.at(-1)).toEqual([0, 'EOF']);
  });

  test('таблицы: слой GREENING_PROPOSED и приложение XDATA GREENPLAN', () => {
    const layer = pairs.findIndex(([code, value]) => code === 0 && value === 'LAYER');
    expect(pairs[layer + 1]).toEqual([2, 'GREENING_PROPOSED']);
    const appid = pairs.findIndex(([code, value]) => code === 0 && value === 'APPID');
    expect(pairs[appid + 1]).toEqual([2, 'GREENPLAN']);
  });

  test('окружности: число, слой, центр, радиус по типу и XDATA как у бэкенда с дополнениями', () => {
    const circles = entitiesOf(pairs);

    expect(circles.map(({ type }) => type)).toEqual(['CIRCLE', 'CIRCLE']);
    const [tree, shrub] = circles;
    if (tree === undefined || shrub === undefined) throw new Error('нет окружностей');
    expect(values(tree, 8)).toEqual(['GREENING_PROPOSED']);
    expect(values(tree, 10)).toEqual(['-1499.2550']);
    expect(values(tree, 20)).toEqual(['202.2700']);
    expect(values(tree, 40)).toEqual(['1.5000']);
    expect(values(shrub, 40)).toEqual(['0.3500']);
    expect(values(tree, 1001)).toEqual(['GREENPLAN']);
    expect(values(tree, 1000)).toEqual([
      'tree',
      'TREE_ROW_CURB',
      'TREE_ROW_CURB-00001',
      'auto',
      'allowed',
      'sorbus_aucuparia',
    ]);
    // Породы нет — её строки тоже нет.
    expect(values(shrub, 1000)).toEqual(['shrub', '', 'manual-1', 'manual', 'rejected']);
  });

  test('перевод строки в данных сервера не разрывает пары', () => {
    const [, shrub] = PLANTINGS;
    if (shrub === undefined) throw new Error('нет посадки');
    const broken = plantingLayerDxf([{ ...shrub, id: 'a\r\n0\r\nEOF' }]);
    const circle = entitiesOf(parsePairs(broken))[0];

    expect(circle === undefined ? [] : values(circle, 1000)[2]).toBe('a__0__EOF');
    expect(
      parsePairs(broken).filter(([code, value]) => code === 0 && value === 'EOF'),
    ).toHaveLength(1);
  });
});

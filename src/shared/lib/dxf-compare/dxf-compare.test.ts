import { describe, expect, test } from 'vitest';

import { compareDigests, digestDxf, type DxfComparison } from './dxf-compare';

// Кириллица фикстур — в cp1251, как в чертеже с $DWGCODEPAGE ANSI_1251: А–я — 0xC0–0xFF.
const cp1251 = (text: string): Uint8Array =>
  Uint8Array.from({ length: text.length }, (_, index) => {
    const code = text.charCodeAt(index);
    return code >= 0x410 && code <= 0x44f ? code - 0x410 + 0xc0 : code;
  });
const dxf = (pairs: [number, string][], eol = '\n') =>
  cp1251(
    pairs.map(([code, value]) => `${String(code).padStart(3, ' ')}${eol}${value}${eol}`).join(''),
  );

const compare = (source: Uint8Array, result: Uint8Array): DxfComparison =>
  compareDigests(digestDxf(source), digestDxf(result));

const statuses = (comparison: DxfComparison) =>
  comparison.kind === 'compared'
    ? Object.fromEntries(comparison.layers.map(({ name, status }) => [name, status]))
    : comparison;

// Исходный R12, как его пишет AutoCAD: CRLF, числа с шестью знаками, флаги с отступом, без handle.
const R12_SOURCE: [number, string][] = [
  [0, 'SECTION'],
  [2, 'HEADER'],
  [9, '$ACADVER'],
  [1, 'AC1009'],
  [9, '$DWGCODEPAGE'],
  [3, 'ANSI_1251'],
  [0, 'ENDSEC'],
  [0, 'SECTION'],
  [2, 'BLOCKS'],
  [0, 'BLOCK'],
  [8, '0'],
  [2, 'ДЕРЕВО'],
  [70, '     0'],
  [0, 'CIRCLE'],
  [8, 'Газон'],
  [10, '0.000000'],
  [20, '0.000000'],
  [40, '1.500000'],
  [0, 'ENDBLK'],
  [8, '0'],
  [0, 'ENDSEC'],
  [0, 'SECTION'],
  [2, 'ENTITIES'],
  [0, 'LINE'],
  [8, 'ДОРОГИ'],
  [10, '10.000000'],
  [20, '3.600000'],
  [11, '75.125000'],
  [21, '3.600000'],
  [0, 'POLYLINE'],
  [8, 'Газон'],
  [66, '     1'],
  [0, 'VERTEX'],
  [8, 'Газон'],
  [10, '1.000000'],
  [20, '2.000000'],
  [0, 'SEQEND'],
  [8, 'Газон'],
  [0, 'TEXT'],
  [8, 'Газон'],
  [10, '5.000000'],
  [20, '5.000000'],
  [40, '2.500000'],
  [1, 'Тротуар  '],
  [0, 'ENDSEC'],
  [0, 'EOF'],
];

// Тот же чертёж после ezdxf.readfile и saveas со слоем результата: LF, кратчайшие числа, флаги
// без отступа, «70 / 0» у VERTEX, пустой путь у BLOCK, блок $MODEL_SPACE, $HANDSEED в HEADER.
const R12_RESULT: [number, string][] = [
  [0, 'SECTION'],
  [2, 'HEADER'],
  [9, '$ACADVER'],
  [1, 'AC1009'],
  [9, '$DWGCODEPAGE'],
  [3, 'ANSI_1251'],
  [9, '$HANDSEED'],
  [5, '2A'],
  [9, '$TDUPDATE'],
  [40, '2461000.5'],
  [0, 'ENDSEC'],
  [0, 'SECTION'],
  [2, 'BLOCKS'],
  [0, 'BLOCK'],
  [8, '0'],
  [2, '$MODEL_SPACE'],
  [70, '0'],
  [1, ''],
  [1001, 'EZDXF'],
  [1000, 'WRITTEN_BY_EZDXF'],
  [0, 'ENDBLK'],
  [8, '0'],
  [0, 'BLOCK'],
  [8, '0'],
  [2, 'ДЕРЕВО'],
  [70, '0'],
  [1, ''],
  [0, 'CIRCLE'],
  [8, 'Газон'],
  [10, '0.0'],
  [20, '0.0'],
  [40, '1.5'],
  [0, 'ENDBLK'],
  [8, '0'],
  [0, 'ENDSEC'],
  [0, 'SECTION'],
  [2, 'ENTITIES'],
  [0, 'LINE'],
  [8, 'ДОРОГИ'],
  [10, '10.0'],
  [20, '3.6'],
  [11, '75.125'],
  [21, '3.6'],
  [0, 'POLYLINE'],
  [8, 'Газон'],
  [66, '1'],
  [0, 'VERTEX'],
  [8, 'Газон'],
  [10, '1.0'],
  [20, '2.0'],
  [70, '0'],
  [0, 'SEQEND'],
  [8, 'Газон'],
  [0, 'TEXT'],
  [8, 'Газон'],
  [10, '5.0'],
  [20, '5.0'],
  [40, '2.5'],
  [1, 'Тротуар  '],
  [0, 'CIRCLE'],
  [8, 'GREENING_PROPOSED'],
  [10, '3.0'],
  [20, '2.2'],
  [40, '1.5'],
  [1001, 'GREENPLAN'],
  [1000, 'tree'],
  [0, 'ENDSEC'],
  [0, 'EOF'],
];

describe('сравнение DXF по слоям', () => {
  test('R12 после пересохранения ezdxf: исходные слои совпадают, добавлен слой результата', () => {
    const comparison = compare(dxf(R12_SOURCE, '\r\n'), dxf(R12_RESULT));

    expect(statuses(comparison)).toEqual({
      Газон: 'same',
      ДОРОГИ: 'same',
      GREENING_PROPOSED: 'added',
    });
    if (comparison.kind !== 'compared') throw new Error('не сравнилось');
    expect(comparison.layers.find(({ name }) => name === 'Газон')).toMatchObject({
      // POLYLINE с VERTEX и SEQEND — одна сущность, TEXT и окружность в блоке «ДЕРЕВО».
      source: 3,
      result: 3,
    });
  });

  test('R12: сдвиг линии на 0,5 м и замена текста — слой изменён', () => {
    const moved = R12_RESULT.map((pair): [number, string] =>
      pair[1] === '10.0' ? [10, '10.5'] : pair[1] === 'Тротуар  ' ? [1, 'Тротуар'] : pair,
    );
    const comparison = compare(dxf(R12_SOURCE, '\r\n'), dxf(moved));

    expect(statuses(comparison)).toEqual({
      Газон: 'changed',
      ДОРОГИ: 'changed',
      GREENING_PROPOSED: 'added',
    });
    if (comparison.kind !== 'compared') throw new Error('не сравнилось');
    expect(comparison.layers.find(({ name }) => name === 'ДОРОГИ')).toMatchObject({
      missing: 1,
      extra: 1,
    });
  });

  test('R2000: новые handle, владелец и $HANDSEED — не изменение; удалённая сущность — изменение', () => {
    const r2000 = (handle: string, owner: string, withLine: boolean): [number, string][] => {
      const line: [number, string][] = [
        [0, 'LINE'],
        [5, handle],
        [330, owner],
        [100, 'AcDbEntity'],
        [8, 'ДОРОГИ'],
        [100, 'AcDbLine'],
        [10, '1.0'],
        [20, '2.0'],
        [11, '3.0'],
        [21, '4.0'],
      ];
      return [
        [0, 'SECTION'],
        [2, 'HEADER'],
        [9, '$ACADVER'],
        [1, 'AC1015'],
        [9, '$DWGCODEPAGE'],
        [3, 'ANSI_1251'],
        [9, '$HANDSEED'],
        [5, handle],
        [0, 'ENDSEC'],
        [0, 'SECTION'],
        [2, 'ENTITIES'],
        ...(withLine ? line : []),
        [0, 'CIRCLE'],
        [5, `${handle}1`],
        [330, owner],
        [100, 'AcDbEntity'],
        [8, 'ДОРОГИ'],
        [100, 'AcDbCircle'],
        [10, '0.0'],
        [20, '0.0'],
        [40, '2.0'],
        [0, 'ENDSEC'],
        [0, 'EOF'],
      ];
    };

    expect(statuses(compare(dxf(r2000('2A', '1F', true)), dxf(r2000('3B', '20', true))))).toEqual({
      ДОРОГИ: 'same',
    });
    const deleted = compare(dxf(r2000('2A', '1F', true)), dxf(r2000('3B', '20', false)));
    expect(statuses(deleted)).toEqual({ ДОРОГИ: 'changed' });
    if (deleted.kind !== 'compared') throw new Error('не сравнилось');
    expect(deleted.layers[0]).toMatchObject({ source: 2, result: 1, missing: 1, extra: 0 });
  });

  test('булев код 290 с отступом AutoCAD и файл без HEADER — как у ezdxf', () => {
    const entities = (flag: string): [number, string][] => [
      [0, 'SECTION'],
      [2, 'ENTITIES'],
      [0, 'MLEADER'],
      [8, 'LEADERS'],
      [290, flag],
      [0, 'ENDSEC'],
      [0, 'EOF'],
    ];
    const comparison = compare(dxf(entities('     1')), dxf(entities('1')));

    expect(statuses(comparison)).toEqual({ LEADERS: 'same' });
    expect(comparison).toMatchObject({ sourceVersion: 'AC1009' });
  });

  test('удалённый слой и отказ для двоичного и нечитаемого файла', () => {
    const line = R12_RESULT.findIndex(([, value]) => value === 'LINE');
    const polyline = R12_RESULT.findIndex(([, value]) => value === 'POLYLINE');
    const withoutRoads = R12_RESULT.filter((_, index) => index < line || index >= polyline);
    expect(statuses(compare(dxf(R12_SOURCE), dxf(withoutRoads)))).toMatchObject({
      ДОРОГИ: 'removed',
    });

    const binary = new TextEncoder().encode('AutoCAD Binary DXF\r\n\u001a\u0000');
    expect(compare(binary, dxf(R12_RESULT))).toEqual({ kind: 'binary', file: 'source' });
    expect(compare(dxf(R12_SOURCE), binary)).toEqual({ kind: 'binary', file: 'result' });
    expect(compare(new TextEncoder().encode('не чертёж'), dxf(R12_RESULT))).toEqual({
      kind: 'invalid',
      file: 'source',
    });
  });
});

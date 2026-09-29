import { describe, expect, test } from 'vitest';

import { type DrawingPlanting, replacePlantingLayer } from './drawing-dxf';

// Кириллица фикстур — в cp1251, как в чертеже с $DWGCODEPAGE ANSI_1251: А–я — 0xC0–0xFF.
const cp1251 = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from({ length: text.length }, (_, index) => {
    const code = text.charCodeAt(index);
    return code >= 0x410 && code <= 0x44f ? code - 0x410 + 0xc0 : code;
  });
const decode = (parts: Uint8Array[]) =>
  new TextDecoder('windows-1251').decode(new Uint8Array(parts.flatMap((part) => [...part])));
const dxf = (pairs: [number, string][], eol = '\n') =>
  cp1251(
    pairs.map(([code, value]) => `${String(code).padStart(3, ' ')}${eol}${value}${eol}`).join(''),
  );

const PLANTINGS: DrawingPlanting[] = [
  { x: 12.5, y: -3.25, plantType: 'tree', ruleId: 'TREE_ROW_CURB', id: 'TREE_ROW_CURB-00001' },
  { x: 1e-7, y: 40, plantType: 'shrub', ruleId: null, id: 'manual-1' },
];

// Чертёж R2000, как его сохраняет ezdxf: владелец сущностей — *Model_Space, у каждой handle.
const R2000: [number, string][] = [
  [0, 'SECTION'],
  [2, 'HEADER'],
  [9, '$ACADVER'],
  [1, 'AC1015'],
  [9, '$DWGCODEPAGE'],
  [3, 'ANSI_1251'],
  [9, '$HANDSEED'],
  [5, '2A'],
  [0, 'ENDSEC'],
  [0, 'SECTION'],
  [2, 'TABLES'],
  [0, 'TABLE'],
  [2, 'LAYER'],
  [5, '2'],
  [0, 'LAYER'],
  [5, '10'],
  [2, 'Бортовой камень'],
  [0, 'LAYER'],
  [5, '11'],
  [2, 'GREENING_PROPOSED'],
  [0, 'ENDTAB'],
  [0, 'TABLE'],
  [2, 'APPID'],
  [5, '9'],
  [0, 'APPID'],
  [5, '12'],
  [2, 'GREENPLAN'],
  [0, 'ENDTAB'],
  [0, 'TABLE'],
  [2, 'BLOCK_RECORD'],
  [5, '1'],
  [0, 'BLOCK_RECORD'],
  [5, '1F'],
  [330, '1'],
  [2, '*Model_Space'],
  [0, 'ENDTAB'],
  [0, 'ENDSEC'],
  [0, 'SECTION'],
  [2, 'ENTITIES'],
  [0, 'LINE'],
  [5, '20'],
  [330, '1F'],
  [100, 'AcDbEntity'],
  [8, 'Бортовой камень'],
  [100, 'AcDbLine'],
  [10, '0.0'],
  [20, '0.0'],
  [30, '0.0'],
  [11, '60.0'],
  [21, '0.0'],
  [31, '0.0'],
  [0, 'CIRCLE'],
  [5, '21'],
  [330, '1F'],
  [100, 'AcDbEntity'],
  [8, 'GREENING_PROPOSED'],
  [100, 'AcDbCircle'],
  [10, '3.0'],
  [20, '2.2'],
  [30, '0.0'],
  [40, '1.5'],
  [1001, 'GREENPLAN'],
  [1000, 'tree'],
  [1000, 'TREE_ROW_CURB'],
  [1000, 'TREE_ROW_CURB-00001'],
  [0, 'TEXT'],
  [5, '22'],
  [330, '1F'],
  [100, 'AcDbEntity'],
  [8, 'Бортовой камень'],
  [100, 'AcDbText'],
  [10, '0.0'],
  [20, '-5.0'],
  [30, '0.0'],
  [40, '1.0'],
  [1, 'Сквер'],
  [0, 'ENDSEC'],
  // Секция без записей в начале — как THUMBNAILIMAGE: размер и данные.
  [0, 'SECTION'],
  [2, 'THUMBNAILIMAGE'],
  [90, '4'],
  [310, '00FF00FF'],
  [0, 'ENDSEC'],
  [0, 'EOF'],
];

// Чертёж R12: таблица слоёв необязательна, приложение XDATA записано.
const R12: [number, string][] = [
  [0, 'SECTION'],
  [2, 'HEADER'],
  [9, '$ACADVER'],
  [1, 'AC1009'],
  [0, 'ENDSEC'],
  [0, 'SECTION'],
  [2, 'TABLES'],
  [0, 'TABLE'],
  [2, 'APPID'],
  [0, 'APPID'],
  [2, 'GREENPLAN'],
  [0, 'ENDTAB'],
  [0, 'ENDSEC'],
  [0, 'SECTION'],
  [2, 'ENTITIES'],
  [0, 'POLYLINE'],
  [8, 'Газон'],
  [66, '1'],
  [0, 'VERTEX'],
  [8, 'Газон'],
  [10, '1.0'],
  [20, '2.0'],
  [0, 'SEQEND'],
  [8, 'Газон'],
  [0, 'CIRCLE'],
  [8, 'GREENING_PROPOSED'],
  [10, '3.0'],
  [20, '2.2'],
  [30, '0.0'],
  [40, '1.5'],
  [0, 'ENDSEC'],
  [0, 'EOF'],
];

describe('replacePlantingLayer', () => {
  test('R2000: слой результата заменён, handle с $HANDSEED и владелец, остальное — байт в байт', () => {
    const source = dxf(R2000);

    const result = replacePlantingLayer(source, PLANTINGS);

    if (result.kind !== 'ready') throw new Error(result.kind);
    const text = decode(result.parts);
    expect(text.match(/\nCIRCLE\n/g)).toHaveLength(2);
    expect(text).not.toContain('  5\n21\n');
    expect(text).toContain(
      '  0\nCIRCLE\n  5\n2A\n330\n1F\n100\nAcDbEntity\n  8\nGREENING_PROPOSED\n100\nAcDbCircle\n 10\n12.5\n 20\n-3.25\n 30\n0.0\n 40\n1.5\n1001\nGREENPLAN\n1000\ntree\n1000\nTREE_ROW_CURB\n1000\nTREE_ROW_CURB-00001\n1000\nauto\n',
    );
    // Без экспоненты; у добавленной вручную правила нет — пустая строка держит место.
    expect(text).toContain('  5\n2B\n');
    expect(text).toContain(' 10\n0.0000001000\n 20\n40.0\n 30\n0.0\n 40\n0.35\n');
    expect(text).toContain('1000\nshrub\n1000\n\n1000\nmanual-1\n1000\nmanual\n');
    expect(text).toContain('$HANDSEED\n  5\n2C\n');
    // Кроме заголовка и слоя результата — те же байты: кириллица не перекодирована.
    const circle = R2000.findIndex(([, value]) => value === 'CIRCLE');
    const afterCircle = R2000.findIndex(([, value], index) => index > circle && value === 'TEXT');
    const expected = decode([
      dxf(R2000.filter((_, index) => index < circle || index >= afterCircle)),
    ]).replace('$HANDSEED\n  5\n2A\n', '$HANDSEED\n  5\n2C\n');
    const inserted = text.slice(
      text.indexOf('  0\nCIRCLE\n  5\n2A'),
      text.indexOf('  0\nENDSEC\n  0\nSECTION\n  2\nTHUMBNAILIMAGE'),
    );
    expect(text.replace(inserted, '')).toBe(expected);
  });

  test('R12 без handle: окружности без 5, 330 и 100; переводы строк CRLF — как в файле', () => {
    const source = dxf(R12, '\r\n');

    const result = replacePlantingLayer(source, PLANTINGS.slice(0, 1));

    if (result.kind !== 'ready') throw new Error(result.kind);
    const text = decode(result.parts);
    expect(text).toContain(
      '  0\r\nSEQEND\r\n  8\r\nГазон\r\n  0\r\nCIRCLE\r\n  8\r\nGREENING_PROPOSED\r\n 10\r\n12.5\r\n',
    );
    expect(text).not.toContain('\n  5\r\n');
    expect(text).not.toContain('AcDbEntity');
    expect(text.match(/CIRCLE/g)).toHaveLength(1);
  });

  test('R12 с $HANDSEED, как сохраняет ezdxf: handle есть, владельца и маркеров нет, $HANDSEED сдвинут', () => {
    const withSeed = R12.flatMap((pair): [number, string][] =>
      pair[1] === 'AC1009' ? [pair, [9, '$HANDSEED'], [5, 'FF']] : [pair],
    );

    const result = replacePlantingLayer(dxf(withSeed), PLANTINGS);

    if (result.kind !== 'ready') throw new Error(result.kind);
    const text = decode(result.parts);
    expect(text).toContain('  0\nCIRCLE\n  5\nFF\n  8\nGREENING_PROPOSED\n');
    expect(text).toContain('  0\nCIRCLE\n  5\n100\n  8\nGREENING_PROPOSED\n');
    expect(text).toContain('$HANDSEED\n  5\n101\n');
    expect(text).not.toContain('AcDbEntity');
  });

  test('R12 без приложения GREENPLAN в таблицах — не собирается: XDATA было бы не зарегистрировано', () => {
    const withoutAppid = R12.filter(([, value]) => value !== 'GREENPLAN');

    expect(replacePlantingLayer(dxf(withoutAppid), PLANTINGS)).toEqual({
      kind: 'unsupported',
      reason: 'no-tables',
    });
  });

  test('$HANDSEED не шестнадцатеричный — не собирается', () => {
    const broken = R2000.map((pair): [number, string] => (pair[1] === '2A' ? [5, 'зерно'] : pair));

    expect(replacePlantingLayer(dxf(broken), PLANTINGS)).toEqual({
      kind: 'unsupported',
      reason: 'bad-handseed',
    });
  });

  test('двоичный DXF не разбирается', () => {
    const binary = new Uint8Array([...cp1251('AutoCAD Binary DXF\r\n'), 0x1a, 0]);

    expect(replacePlantingLayer(binary, PLANTINGS)).toEqual({ kind: 'binary' });
  });

  test('R2000 без слоя результата в таблицах — не собирается: добавлять записи таблиц нельзя', () => {
    const withoutLayer = R2000.filter(
      ([, value]) => value !== '11' && value !== 'GREENING_PROPOSED',
    );

    expect(replacePlantingLayer(dxf(withoutLayer), PLANTINGS).kind).toBe('unsupported');
  });

  test('без секции ENTITIES — не собирается', () => {
    const source = dxf([
      [0, 'SECTION'],
      [2, 'HEADER'],
      [9, '$ACADVER'],
      [1, 'AC1009'],
      [0, 'ENDSEC'],
      [0, 'EOF'],
    ]);

    expect(replacePlantingLayer(source, PLANTINGS)).toEqual({
      kind: 'unsupported',
      reason: 'no-entities',
    });
  });
});

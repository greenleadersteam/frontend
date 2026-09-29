import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, test } from 'vitest';

import { type XlsxSheet, xlsxWorkbook } from './xlsx';

const SHEET: XlsxSheet = {
  name: 'Ведомость посадок',
  header: ['№', 'Наименование', 'Широта'],
  rows: [
    [1, 'Липа мелколистная', 55.759346],
    [2, 'Сирень <обыкновенная> & «шрус»', null],
  ],
  totals: [[null, 'Итого деревьев', 2]],
};

const parts = (sheet: XlsxSheet = SHEET) => {
  const files = unzipSync(xlsxWorkbook(sheet));
  return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, strFromU8(bytes)]));
};

const sheetXml = (sheet?: XlsxSheet) => {
  const xml = parts(sheet)['xl/worksheets/sheet1.xml'];
  if (xml === undefined) throw new Error('нет листа');
  return xml;
};

const cell = (xml: string, ref: string) =>
  new RegExp(`<c r="${ref}"[^>]*?(/>|>.*?</c>)`).exec(xml)?.[0];

describe('xlsxWorkbook', () => {
  test('книга с одним листом: все части SpreadsheetML на месте', () => {
    const files = parts();

    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    expect(files['xl/workbook.xml']).toContain('<sheet name="Ведомость посадок" sheetId="1"');
  });

  test('числа — числами, текст — строкой в ячейке, кириллица как есть', () => {
    const xml = sheetXml();

    expect(cell(xml, 'A2')).toBe('<c r="A2"><v>1</v></c>');
    expect(cell(xml, 'C2')).toBe('<c r="C2"><v>55.759346</v></c>');
    expect(cell(xml, 'B2')).toBe(
      '<c r="B2" t="inlineStr"><is><t xml:space="preserve">Липа мелколистная</t></is></c>',
    );
    expect(cell(xml, 'C3')).toBe('<c r="C3"/>');
  });

  test('спецсимволы XML экранируются, управляющие символы выбрасываются', () => {
    expect(cell(sheetXml(), 'B3')).toContain('Сирень &lt;обыкновенная&gt; &amp; «шрус»');
    const xml = sheetXml({ ...SHEET, rows: [[1, 'а\u0001б\u000Bв', 1]] });
    expect(cell(xml, 'B2')).toContain('>абв<');
  });

  test('заголовок и итоги — жирным; итоги — сразу под строками', () => {
    const xml = sheetXml();

    expect(cell(xml, 'A1')).toBe(
      '<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">№</t></is></c>',
    );
    expect(cell(xml, 'C4')).toBe('<c r="C4" s="1"><v>2</v></c>');
    expect(parts()['xl/styles.xml']).toMatch(
      /<cellXfs count="2">.*<xf[^>]*fontId="1"[^>]*applyFont="1"/,
    );
    expect(parts()['xl/styles.xml']).toMatch(/<fonts count="2">.*<font><b\/>/);
  });

  test('строка заголовков закреплена', () => {
    expect(sheetXml()).toContain(
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>',
    );
  });

  test('ширины колонок — по самому длинному значению, в пределах', () => {
    const xml = sheetXml({ ...SHEET, rows: [[1, 'я'.repeat(200), 55.1]] });

    expect(xml).toContain('<col min="1" max="1" width="6" customWidth="1"/>');
    expect(xml).toContain('<col min="2" max="2" width="60" customWidth="1"/>');
    expect(xml).toContain('<col min="3" max="3" width="8" customWidth="1"/>');
  });

  test('лист на 150 000 строк собирается: ширины считаются без передачи строк аргументами', () => {
    const rows = Array.from({ length: 150_000 }, (_, index) => [index]);

    expect(() => xlsxWorkbook({ name: 'Проверки', header: ['№'], rows, totals: [] })).not.toThrow();
  });

  test('колонки после Z — AA, AB', () => {
    const header = Array.from({ length: 28 }, (_, index) => `К${String(index)}`);
    const xml = sheetXml({ ...SHEET, header, rows: [header.map((_, index) => index)], totals: [] });

    expect(cell(xml, 'Z2')).toBe('<c r="Z2"><v>25</v></c>');
    expect(cell(xml, 'AB2')).toBe('<c r="AB2"><v>27</v></c>');
  });
});

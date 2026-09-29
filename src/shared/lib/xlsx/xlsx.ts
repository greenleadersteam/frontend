import { strToU8, zipSync } from 'fflate';

// Ячейка листа: текст, число или пусто. Числа пишутся числами — Excel считает по ним сумму и
// сортирует их как числа, а не как текст.
export type XlsxCell = string | number | null;

export type XlsxSheet = {
  // Имя листа: до 31 символа, без [ ] : * ? / \ — так требует Excel.
  name: string;
  header: string[];
  rows: XlsxCell[][];
  // Итоговые строки под таблицей — жирным, как заголовок.
  totals: XlsxCell[][];
};

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Ширина колонки в символах: по самому длинному значению, в разумных пределах.
const MIN_WIDTH = 6;
const MAX_WIDTH = 60;

// Символы, которых нет в XML 1.0: Excel откажется открыть файл с ними.
// eslint-disable-next-line no-control-regex -- выражение и ищет управляющие символы
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

const escapeXml = (text: string): string =>
  text
    .replace(INVALID_XML, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

// A, B, …, Z, AA, AB, …
function columnName(index: number): string {
  let name = '';
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
  }
  return name;
}

const BOLD_STYLE = 1;

// Текст — строкой прямо в ячейке (inlineStr): без таблицы общих строк файл проще, а формулой
// такая ячейка не станет никогда — защита от подстановки формул, как у CSV, здесь не нужна.
function cellXml(value: XlsxCell, ref: string, style: number): string {
  const styleAttribute = style === 0 ? '' : ` s="${String(style)}"`;
  if (value === null || value === '') return `<c r="${ref}"${styleAttribute}/>`;
  if (typeof value === 'number') {
    return `<c r="${ref}"${styleAttribute}><v>${String(value)}</v></c>`;
  }
  return `<c r="${ref}"${styleAttribute} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

const rowXml = (cells: XlsxCell[], rowIndex: number, style: number): string =>
  `<row r="${String(rowIndex + 1)}">${cells
    .map((cell, column) => cellXml(cell, `${columnName(column)}${String(rowIndex + 1)}`, style))
    .join('')}</row>`;

const cellLength = (cell: XlsxCell | undefined): number =>
  cell === null || cell === undefined ? 0 : String(cell).length;

function columnsXml(sheet: XlsxSheet): string {
  const all = [sheet.header, ...sheet.rows, ...sheet.totals];
  // Без Math.max(...строки): у листа на сотни тысяч строк аргументов больше, чем принимает движок.
  const widths = sheet.header.map((_, column) =>
    Math.min(
      MAX_WIDTH,
      all.reduce((width, cells) => Math.max(width, cellLength(cells[column]) + 2), MIN_WIDTH),
    ),
  );
  return `<cols>${widths
    .map(
      (width, column) =>
        `<col min="${String(column + 1)}" max="${String(column + 1)}" width="${String(width)}" customWidth="1"/>`,
    )
    .join('')}</cols>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const rows = [
    rowXml(sheet.header, 0, BOLD_STYLE),
    ...sheet.rows.map((cells, index) => rowXml(cells, index + 1, 0)),
    ...sheet.totals.map((cells, index) => rowXml(cells, sheet.rows.length + index + 1, BOLD_STYLE)),
  ];
  // Строка заголовков закреплена: при прокрутке длинной ведомости видно, что в какой колонке.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>${columnsXml(sheet)}<sheetData>${rows.join('')}</sheetData></worksheet>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

// Два стиля ячеек: обычный и жирный (BOLD_STYLE) — для заголовка и итогов.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const workbookXml = (
  name: string,
): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

// Книга Excel с одним листом — минимальный набор частей SpreadsheetML (ECMA-376), без
// библиотеки: ZIP собирает fflate, который уже есть в проекте.
export function xlsxWorkbook(sheet: XlsxSheet): Uint8Array<ArrayBuffer> {
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'xl/workbook.xml': strToU8(workbookXml(sheet.name)),
    'xl/_rels/workbook.xml.rels': strToU8(WORKBOOK_RELS),
    'xl/styles.xml': strToU8(STYLES),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml(sheet)),
  });
}

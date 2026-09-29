import type { PlantType } from '../model/project';
import { CROWN_RADIUS_M } from './plan-projection';
import { PLANTING_LAYER, safeText, XDATA_APPID } from './planting-dxf';

// Посадка для чертежа сервиса: XDATA — ровно то, что пишет сервер (тип, правило, id,
// ../backend/greenplan/io/dxf_sink.py:100).
export type DrawingPlanting = {
  x: number;
  y: number;
  plantType: PlantType;
  // null — добавлена вручную: правила нет, в XDATA пустая строка держит место.
  ruleId: string | null;
  id: string;
};

export type DrawingDxf =
  // Части файла по порядку: срезы исходного файла и вставки — без копии 17 МБ на каждом шаге.
  | { kind: 'ready'; parts: Uint8Array<ArrayBuffer>[] }
  // Сервер сохраняет DXF в формате исходного (../backend/greenplan/io/dxf_sink.py:82): двоичный
  // здесь не разбирается.
  | { kind: 'binary' }
  // Файл не такой, какой пишет сервер: секция не закрыта, нет ENTITIES или $ACADVER, в таблицах
  // нет приложения XDATA (у R2000+ — и слоя результата), нет $HANDSEED или пространства модели.
  | { kind: 'unsupported'; reason: UnsupportedReason };

type UnsupportedReason =
  'unclosed-section' | 'no-entities' | 'no-version' | 'no-tables' | 'no-handles' | 'bad-handseed';
const BINARY_SENTINEL = 'AutoCAD Binary DXF';
// R12 и раньше: у сущностей нет владельца (330) и маркеров подклассов (100).
const R12 = 'AC1009';

const ascii = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(text, (char) => char.charCodeAt(0));
const decodeAscii = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

// Значения, с которыми сравниваются строки файла, — ASCII: сравнение по байтам, без
// декодирования всего файла из его кодовой страницы.
function sameBytes(source: Uint8Array, start: number, end: number, expected: Uint8Array): boolean {
  if (end - start !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (source[start + index] !== expected[index]) return false;
  }
  return true;
}

// Пара «код — значение»: код разобран, значение — диапазон байтов без перевода строки.
type Tag = { code: number; start: number; valueStart: number; valueEnd: number; next: number };

const NEWLINE = 10;
const CARRIAGE_RETURN = 13;

function lineEnd(source: Uint8Array, from: number): { end: number; next: number } | null {
  const newline = source.indexOf(NEWLINE, from);
  if (newline === -1) return null;
  const end = newline > from && source[newline - 1] === CARRIAGE_RETURN ? newline - 1 : newline;
  return { end, next: newline + 1 };
}

function parseCode(source: Uint8Array, start: number, end: number): number | null {
  let value = 0;
  let digits = 0;
  let negative = false;
  for (let index = start; index < end; index += 1) {
    const byte = source[index] ?? 0;
    if (byte === 32) continue;
    if (byte === 45 && digits === 0) {
      negative = true;
      continue;
    }
    if (byte < 48 || byte > 57) return null;
    value = value * 10 + byte - 48;
    digits += 1;
  }
  if (digits === 0) return null;
  return negative ? -value : value;
}

function readTag(source: Uint8Array, start: number): Tag | null {
  const codeLine = lineEnd(source, start);
  if (codeLine === null) return null;
  const code = parseCode(source, start, codeLine.end);
  const valueLine = lineEnd(source, codeLine.next);
  if (code === null || valueLine === null) return null;
  return { code, start, valueStart: codeLine.next, valueEnd: valueLine.end, next: valueLine.next };
}

const BYTES = {
  section: ascii('SECTION'),
  endsec: ascii('ENDSEC'),
  header: ascii('HEADER'),
  tables: ascii('TABLES'),
  entities: ascii('ENTITIES'),
  acadver: ascii('$ACADVER'),
  handseed: ascii('$HANDSEED'),
  layer: ascii('LAYER'),
  appid: ascii('APPID'),
  blockRecord: ascii('BLOCK_RECORD'),
  plantingLayer: ascii(PLANTING_LAYER),
  appidName: ascii(XDATA_APPID),
};

// Сущность или запись таблицы: от её пары с кодом 0 до следующей такой пары.
type Record0 = { start: number; end: number; type: Uint8Array; tags: Tag[] };

// Коды, которые нужны из записей: имя (2), handle (5), слой (8), владелец (330).
const KEPT_CODES = new Set([2, 5, 8, 330]);

function* records(source: Uint8Array, from: number): Generator<Record0 | { end: number }> {
  let tag = readTag(source, from);
  // Секция может начинаться не с записи: THUMBNAILIMAGE — с размера (90) и данных (310).
  while (tag !== null && tag.code !== 0) tag = readTag(source, tag.next);
  while (tag !== null) {
    const type = source.subarray(tag.valueStart, tag.valueEnd);
    if (sameBytes(source, tag.valueStart, tag.valueEnd, BYTES.endsec)) {
      yield { end: tag.start };
      return;
    }
    const start = tag.start;
    const tags: Tag[] = [];
    // До XDATA (1001) — собственные группы записи: слой 8 в XDATA не встречается, но код 1000+
    // смотреть незачем.
    let inXdata = false;
    tag = readTag(source, tag.next);
    while (tag !== null && tag.code !== 0) {
      if (tag.code === 1001) inXdata = true;
      if (!inXdata && KEPT_CODES.has(tag.code)) tags.push(tag);
      tag = readTag(source, tag.next);
    }
    if (tag === null) return;
    yield { start, end: tag.start, type, tags };
  }
}

const valueOf = (tags: Tag[], code: number): Tag | undefined =>
  tags.find((tag) => tag.code === code);

// Число для DXF: полная точность без экспоненты, которую понимают не все читатели.
function formatNumber(value: number): string {
  const text = String(value);
  if (!text.includes('e')) return text.includes('.') ? text : `${text}.0`;
  return value.toFixed(10);
}

const code = (value: number) => String(value).padStart(3, ' ');

// Чертёж сервиса с итоговой расстановкой: из ENTITIES убираются сущности слоя результата,
// перед концом секции встают окружности итоговой расстановки. Всё остальное — байты сервера.
// Новые handle — с $HANDSEED, и он сдвигается за последний. Слой и APPID уже есть в таблицах:
// их добавил сервер (../backend/greenplan/io/dxf_sink.py:87-91). Строки XDATA — как в слое из
// браузера (safeText): кодовую страницу чертежа они не задевают.
export function replacePlantingLayer(
  source: Uint8Array<ArrayBuffer>,
  plantings: readonly DrawingPlanting[],
): DrawingDxf {
  if (decodeAscii(source.subarray(0, BINARY_SENTINEL.length)) === BINARY_SENTINEL) {
    return { kind: 'binary' };
  }
  const firstLine = lineEnd(source, 0);
  const eol = firstLine !== null && source[firstLine.end] === CARRIAGE_RETURN ? '\r\n' : '\n';

  let version: string | null = null;
  let seed: Tag | null = null;
  let layerFound = false;
  let appidFound = false;
  let modelSpace: string | null = null;
  let entitiesEnd: number | null = null;
  const removed: { start: number; end: number }[] = [];

  let tag = readTag(source, 0);
  while (tag !== null) {
    if (tag.code === 0 && sameBytes(source, tag.valueStart, tag.valueEnd, BYTES.section)) {
      const name = readTag(source, tag.next);
      if (name?.code !== 2) break;
      const kind = source.subarray(name.valueStart, name.valueEnd);
      if (sameBytes(kind, 0, kind.length, BYTES.header)) {
        // Переменные заголовка: пара 9 с именем, за ней её значения.
        let variable: Uint8Array | null = null;
        let next = readTag(source, name.next);
        while (next !== null && next.code !== 0) {
          if (next.code === 9) variable = source.subarray(next.valueStart, next.valueEnd);
          else if (variable !== null && sameBytes(variable, 0, variable.length, BYTES.acadver)) {
            version = decodeAscii(source.subarray(next.valueStart, next.valueEnd)).trim();
          } else if (
            variable !== null &&
            next.code === 5 &&
            sameBytes(variable, 0, variable.length, BYTES.handseed)
          ) {
            seed = next;
          }
          next = readTag(source, next.next);
        }
        tag = next;
        continue;
      }
      const isTables = sameBytes(kind, 0, kind.length, BYTES.tables);
      const isEntities = sameBytes(kind, 0, kind.length, BYTES.entities);
      let sectionEnd: number | null = null;
      for (const record of records(source, name.next)) {
        if (!('type' in record)) {
          sectionEnd = record.end;
          break;
        }
        const name2 = valueOf(record.tags, 2);
        const layer = valueOf(record.tags, 8);
        if (isTables && name2 !== undefined) {
          const { type } = record;
          const named = (expected: Uint8Array) =>
            sameBytes(source, name2.valueStart, name2.valueEnd, expected);
          if (sameBytes(type, 0, type.length, BYTES.layer) && named(BYTES.plantingLayer)) {
            layerFound = true;
          } else if (sameBytes(type, 0, type.length, BYTES.appid) && named(BYTES.appidName)) {
            appidFound = true;
          } else if (sameBytes(type, 0, type.length, BYTES.blockRecord)) {
            const blockName = decodeAscii(source.subarray(name2.valueStart, name2.valueEnd));
            const handle = valueOf(record.tags, 5);
            if (blockName.toUpperCase() === '*MODEL_SPACE' && handle !== undefined) {
              modelSpace = decodeAscii(source.subarray(handle.valueStart, handle.valueEnd));
            }
          }
        }
        if (
          isEntities &&
          layer !== undefined &&
          sameBytes(source, layer.valueStart, layer.valueEnd, BYTES.plantingLayer)
        ) {
          removed.push({ start: record.start, end: record.end });
        }
      }
      if (sectionEnd === null) return { kind: 'unsupported', reason: 'unclosed-section' };
      if (isEntities) entitiesEnd = sectionEnd;
      tag = readTag(source, sectionEnd);
      // Пропустить пару ENDSEC.
      tag = tag === null ? null : readTag(source, tag.next);
      continue;
    }
    tag = readTag(source, tag.next);
  }

  if (entitiesEnd === null) return { kind: 'unsupported', reason: 'no-entities' };
  if (version === null) return { kind: 'unsupported', reason: 'no-version' };
  const modern = version > R12;
  // XDATA без записи приложения строгие читатели отвергают; таблица слоёв в R12 необязательна.
  if (!appidFound || (modern && !layerFound)) return { kind: 'unsupported', reason: 'no-tables' };
  if (modern && (seed === null || modelSpace === null)) {
    return { kind: 'unsupported', reason: 'no-handles' };
  }
  const seedText =
    seed === null ? null : decodeAscii(source.subarray(seed.valueStart, seed.valueEnd)).trim();
  if (seedText !== null && !/^[0-9A-Fa-f]+$/.test(seedText)) {
    return { kind: 'unsupported', reason: 'bad-handseed' };
  }

  let nextHandle = seedText === null ? null : BigInt(`0x${seedText}`);
  // Владелец и маркеры подклассов — только у R2000+; у них пространство модели найдено выше.
  const owner = modern ? modelSpace : null;
  const lines: string[] = [];
  for (const { x, y, plantType, ruleId, id } of plantings) {
    lines.push(code(0), 'CIRCLE');
    if (nextHandle !== null) {
      lines.push(code(5), nextHandle.toString(16).toUpperCase());
      nextHandle += 1n;
    }
    if (owner !== null) lines.push(code(330), owner, code(100), 'AcDbEntity');
    lines.push(code(8), PLANTING_LAYER);
    if (owner !== null) lines.push(code(100), 'AcDbCircle');
    lines.push(
      code(10),
      formatNumber(x),
      code(20),
      formatNumber(y),
      code(30),
      '0.0',
      code(40),
      formatNumber(CROWN_RADIUS_M[plantType]),
      code(1001),
      XDATA_APPID,
      code(1000),
      plantType,
      code(1000),
      safeText(ruleId ?? ''),
      code(1000),
      safeText(id),
    );
  }
  const inserted = ascii(lines.map((line) => line + eol).join(''));

  const parts: Uint8Array<ArrayBuffer>[] = [];
  let cursor = 0;
  if (seed !== null && nextHandle !== null) {
    parts.push(source.subarray(0, seed.valueStart), ascii(nextHandle.toString(16).toUpperCase()));
    cursor = seed.valueEnd;
  }
  for (const range of removed) {
    parts.push(source.subarray(cursor, range.start));
    cursor = range.end;
  }
  parts.push(source.subarray(cursor, entitiesEnd), inserted, source.subarray(entitiesEnd));
  return { kind: 'ready', parts };
}

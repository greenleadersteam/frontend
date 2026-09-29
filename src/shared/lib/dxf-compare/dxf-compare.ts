// Сравнение двух ASCII DXF по слоям: число сущностей и содержимое каждой. Сервер не дописывает
// файл, а читает и сохраняет его целиком (ezdxf, ../backend/greenplan/io/dxf_sink.py): байты
// меняются, даже если ни одна сущность не тронута. Поэтому сравниваются значения, а не строки:
// числа — как числа («10.000000» и «10.0» совпадают), без handle (5) и владельца (330), которые
// сохранение вправе переназначить. $HANDSEED и даты сохранения лежат в HEADER и не читаются.
// ezdxf дописывает умолчания, которых в исходном R12 не было: «70 / 0» у VERTEX, пустой путь
// «1» у BLOCK, блоки $MODEL_SPACE и $PAPER_SPACE. Поэтому нулевой флаг и пустая строка равны
// отсутствующему тегу, а записи BLOCK и ENDBLK — рамка определения блока, а не сущность чертежа:
// сущности внутри блоков сравниваются. VERTEX, SEQEND и ATTRIB — части своей POLYLINE или INSERT:
// они входят в её хеш, а отдельными сущностями слоя не считаются, как и в САПР. Файл без HEADER
// ezdxf читает как R12 — так же и здесь.

export type LayerStatus = 'same' | 'changed' | 'added' | 'removed';

export type LayerComparison = {
  name: string;
  source: number;
  result: number;
  status: LayerStatus;
  // Сущности, которых нет в другом файле: удалённые или изменённые (старый вид) и
  // добавленные или изменённые (новый вид).
  missing: number;
  extra: number;
};

export type DxfRole = 'source' | 'result';

export type DxfComparison =
  | { kind: 'compared'; sourceVersion: string; resultVersion: string; layers: LayerComparison[] }
  | { kind: 'binary'; file: DxfRole }
  | { kind: 'invalid'; file: DxfRole };

type LayerDigest = {
  // Хеши сущностей слоя с кратностью: порядок сущностей содержимым слоя не считается.
  entities: Map<string, number>;
  count: number;
};

export type DxfDigest =
  | { kind: 'ascii'; version: string; layers: Map<string, LayerDigest> }
  | { kind: 'binary' }
  | { kind: 'invalid' };

const BINARY_SENTINEL = 'AutoCAD Binary DXF';
const IGNORED_CODES = new Set([5, 330]);
// Секции, где лежат сущности: пространства модели и листа и определения блоков.
const ENTITY_SECTIONS = new Set(['ENTITIES', 'BLOCKS']);
const BLOCK_FRAME = new Set(['BLOCK', 'ENDBLK']);
const SUBENTITIES = new Set(['VERTEX', 'SEQEND', 'ATTRIB']);
const R12 = 'AC1009';
const NEW_LINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const NUMBER_MARK = 0x3d;
const TEXT_MARK = 0x3a;
const PROGRESS_STEP = 1 << 20;

// Числа по диапазонам групповых кодов DXF (справочник DXF, «Group code value types»).
function isNumeric(code: number): boolean {
  return (
    (code >= 10 && code <= 99) ||
    (code >= 110 && code <= 179) ||
    (code >= 210 && code <= 299) ||
    (code >= 370 && code <= 389) ||
    (code >= 400 && code <= 409) ||
    (code >= 420 && code <= 429) ||
    (code >= 440 && code <= 469) ||
    (code >= 1010 && code <= 1071)
  );
}

// Целочисленные флаги 70–78: без тега значение — 0.
const isFlag = (code: number): boolean => code >= 70 && code <= 78;

// Кодовая страница R12–R2004 из $DWGCODEPAGE («ANSI_1251» → windows-1251); с R2007 — UTF-8.
function textDecoder(version: string, codePage: string | null): TextDecoder {
  if (version >= 'AC1021') return new TextDecoder('utf-8');
  const page = codePage === null ? undefined : /^ANSI_(\d+)$/i.exec(codePage)?.[1];
  try {
    return new TextDecoder(`windows-${page ?? '1252'}`);
  } catch {
    return new TextDecoder('windows-1252');
  }
}

// latin1, а не String.fromCharCode(...): строка файла, который не DXF, бывает в сотни КБ, и
// спред превысил бы предел аргументов.
const latin1 = new TextDecoder('latin1');
const decodeAscii = (bytes: Uint8Array, start: number, end: number): string =>
  latin1.decode(bytes.subarray(start, end));

// Хеш сущности — 64 бита из двух FNV-1a с разными множителями по её парам «код — значение» по
// порядку. Строки отпечатков целиком заняли бы в памяти больше самого файла 17 МБ, а вероятность
// совпадения хешей у разных сущностей при миллионе сущностей — порядка 10⁻⁸.
class EntityHash {
  private low = 0x811c9dc5;
  private high = 0x050c5d1f;

  byte(value: number): void {
    this.low = Math.imul(this.low ^ value, 0x01000193);
    this.high = Math.imul(this.high ^ value, 0x01000343);
  }

  text(value: string): void {
    for (let index = 0; index < value.length; index += 1) this.byte(value.charCodeAt(index));
  }

  bytes(source: Uint8Array, start: number, end: number): void {
    for (let index = start; index < end; index += 1) this.byte(source[index] ?? 0);
  }

  digest(): string {
    const hex = (value: number) => (value >>> 0).toString(16).padStart(8, '0');
    return hex(this.high) + hex(this.low);
  }
}

type Progress = (done: number, total: number) => void;

export function digestDxf(bytes: Uint8Array, onProgress?: Progress): DxfDigest {
  const head = decodeAscii(bytes, 0, Math.min(bytes.length, BINARY_SENTINEL.length));
  if (head === BINARY_SENTINEL) return { kind: 'binary' };

  const total = bytes.length;
  let position = 0;
  let nextReport = 0;
  const readLine = (): [number, number] | null => {
    if (position >= total) return null;
    const start = position;
    let end = bytes.indexOf(NEW_LINE, position);
    if (end === -1) end = total;
    position = end + 1;
    if (end > start && bytes[end - 1] === CARRIAGE_RETURN) end -= 1;
    return [start, end];
  };

  let version = '';
  let codePage: string | null = null;
  let decoder: TextDecoder | null = null;
  let section: string | null = null;
  let sections = 0;
  let sectionName = false;
  let headerVariable: string | null = null;
  const layers = new Map<string, LayerDigest>();
  let entity: EntityHash | null = null;
  let layerName: [number, number] | null = null;

  const closeEntity = () => {
    if (entity === null) return;
    decoder ??= textDecoder(version, codePage);
    const name = layerName === null ? '0' : decoder.decode(bytes.subarray(...layerName));
    const layer = layers.get(name) ?? { entities: new Map<string, number>(), count: 0 };
    const hash = entity.digest();
    layer.entities.set(hash, (layer.entities.get(hash) ?? 0) + 1);
    layer.count += 1;
    layers.set(name, layer);
    entity = null;
    layerName = null;
  };

  for (;;) {
    const codeLine = readLine();
    if (codeLine === null) break;
    const valueLine = readLine();
    if (valueLine === null) return { kind: 'invalid' };
    const code = Number(decodeAscii(bytes, ...codeLine).trim());
    if (!Number.isInteger(code)) return { kind: 'invalid' };
    if (onProgress !== undefined && position >= nextReport) {
      onProgress(position, total);
      nextReport = position + PROGRESS_STEP;
    }

    if (code === 0) {
      const value = decodeAscii(bytes, ...valueLine).trim();
      if (entity !== null && SUBENTITIES.has(value)) {
        entity.byte(NEW_LINE);
        entity.text(value);
        continue;
      }
      closeEntity();
      if (value === 'SECTION') sectionName = true;
      else if (value === 'ENDSEC') section = null;
      else if (value === 'EOF') break;
      else if (section !== null && ENTITY_SECTIONS.has(section) && !BLOCK_FRAME.has(value)) {
        entity = new EntityHash();
        entity.text(value);
      }
      continue;
    }
    if (sectionName) {
      if (code === 2) section = decodeAscii(bytes, ...valueLine).trim();
      sectionName = false;
      sections += 1;
      continue;
    }
    if (section === 'HEADER') {
      const value = decodeAscii(bytes, ...valueLine).trim();
      if (code === 9) headerVariable = value;
      else if (headerVariable === '$ACADVER') version = value;
      else if (headerVariable === '$DWGCODEPAGE') codePage = value;
      continue;
    }
    if (entity === null || IGNORED_CODES.has(code)) continue;
    if (code === 8) layerName ??= valueLine;
    if (isNumeric(code)) {
      const value = Number(decodeAscii(bytes, ...valueLine).trim());
      if (value === 0 && isFlag(code)) continue;
      entity.byte(NEW_LINE);
      entity.text(String(code));
      entity.byte(NUMBER_MARK);
      entity.text(String(value));
    } else {
      if (valueLine[0] === valueLine[1]) continue;
      // Строка — байтами файла: кодовую страницу для сравнения декодировать не нужно.
      entity.byte(NEW_LINE);
      entity.text(String(code));
      entity.byte(TEXT_MARK);
      entity.bytes(bytes, ...valueLine);
    }
  }
  closeEntity();
  if (sections === 0) return { kind: 'invalid' };
  onProgress?.(total, total);
  return { kind: 'ascii', version: version === '' ? R12 : version, layers };
}

// Сколько хешей из from нет в to, с учётом кратности.
function missingIn(from: Map<string, number>, to: Map<string, number>): number {
  let missing = 0;
  for (const [hash, count] of from) missing += Math.max(0, count - (to.get(hash) ?? 0));
  return missing;
}

const NO_ENTITIES = new Map<string, number>();

export function compareDigests(source: DxfDigest, result: DxfDigest): DxfComparison {
  if (source.kind === 'binary') return { kind: 'binary', file: 'source' };
  if (result.kind === 'binary') return { kind: 'binary', file: 'result' };
  if (source.kind === 'invalid') return { kind: 'invalid', file: 'source' };
  if (result.kind === 'invalid') return { kind: 'invalid', file: 'result' };
  const names = new Set([...source.layers.keys(), ...result.layers.keys()]);
  const layers = [...names].map((name): LayerComparison => {
    const before = source.layers.get(name);
    const after = result.layers.get(name);
    const missing = missingIn(before?.entities ?? NO_ENTITIES, after?.entities ?? NO_ENTITIES);
    const extra = missingIn(after?.entities ?? NO_ENTITIES, before?.entities ?? NO_ENTITIES);
    const status: LayerStatus =
      before === undefined
        ? 'added'
        : after === undefined
          ? 'removed'
          : missing === 0 && extra === 0
            ? 'same'
            : 'changed';
    return { name, source: before?.count ?? 0, result: after?.count ?? 0, status, missing, extra };
  });
  return {
    kind: 'compared',
    sourceVersion: source.version,
    resultVersion: result.version,
    layers,
  };
}

export type ZipEntry = { path: string; size: number; isDirectory: boolean };

export type ZipListing =
  | { kind: 'listed'; entries: ZipEntry[]; fileCount: number; totalSize: number }
  | { kind: 'not-zip' }
  | { kind: 'empty' }
  // Список файлов не прочитан: ZIP64 или повреждённый каталог. Решение о приёме — за сервером.
  | { kind: 'unreadable'; reason: 'zip64' | 'corrupted' };

const LOCAL_FILE_SIGNATURE = 0x04034b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;

const EOCD_SIZE = 22;
// EOCD плюс комментарий архива длиной до 65 535 байт.
const EOCD_SEARCH_WINDOW = EOCD_SIZE + 0xffff;
const CENTRAL_HEADER_SIZE = 46;
const UTF8_NAME_FLAG = 1 << 11;

const readBytes = async (blob: Blob, start: number, end: number): Promise<DataView> =>
  new DataView(await blob.slice(start, end).arrayBuffer());

const utf8 = new TextDecoder('utf-8');
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
const cp866 = new TextDecoder('ibm866');

// Без флага UTF-8 имена бывают двух видов: CP866 из «Сжатых папок» Windows и UTF-8 из zip
// на macOS и Linux, который флаг не ставит. Кириллица в CP866 почти никогда не образует
// корректный UTF-8, поэтому сначала пробуем строгий UTF-8, а при ошибке читаем как CP866.
function decodeName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return utf8.decode(bytes);
  try {
    return strictUtf8.decode(bytes);
  } catch {
    return cp866.decode(bytes);
  }
}

// Запись каталога с положением имени в файле: в центральном каталоге и в локальном заголовке.
type DirectoryEntry = ZipEntry & {
  centralNameOffset: number;
  localHeaderOffset: number;
  nameBytes: Uint8Array;
};

type Directory =
  { kind: 'listed'; entries: DirectoryEntry[] } | Exclude<ZipListing, { kind: 'listed' }>;

// Читает только сигнатуру, хвост с EOCD и центральный каталог — через Blob.slice, без
// распаковки и без чтения файла целиком (security.md, «Загрузка архива»).
export async function readZipListing(file: Blob): Promise<ZipListing> {
  const directory = await readDirectory(file);
  if (directory.kind !== 'listed') return directory;
  const entries = directory.entries.map(({ path, size, isDirectory }) => ({
    path,
    size,
    isDirectory,
  }));
  const files = entries.filter(({ isDirectory }) => !isDirectory);
  return {
    kind: 'listed',
    entries,
    fileCount: files.length,
    totalSize: files.reduce((sum, { size }) => sum + size, 0),
  };
}

async function readDirectory(file: Blob): Promise<Directory> {
  if (file.size < 4) return { kind: 'not-zip' };
  const head = (await readBytes(file, 0, 4)).getUint32(0, true);
  if (head === END_OF_CENTRAL_DIRECTORY_SIGNATURE) return { kind: 'empty' };
  if (head !== LOCAL_FILE_SIGNATURE) return { kind: 'not-zip' };

  const tailStart = Math.max(0, file.size - EOCD_SEARCH_WINDOW);
  const tail = await readBytes(file, tailStart, file.size);
  let eocd = -1;
  for (let offset = tail.byteLength - EOCD_SIZE; offset >= 0; offset -= 1) {
    if (tail.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    // Комментарий архива заканчивается ровно в конце файла: так отсекаются байты, похожие
    // на сигнатуру, внутри самого комментария.
    const commentLength = tail.getUint16(offset + 20, true);
    if (offset + EOCD_SIZE + commentLength === tail.byteLength) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) return { kind: 'unreadable', reason: 'corrupted' };

  const entryCount = tail.getUint16(eocd + 10, true);
  const directorySize = tail.getUint32(eocd + 12, true);
  const directoryOffset = tail.getUint32(eocd + 16, true);
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    return { kind: 'unreadable', reason: 'zip64' };
  }
  if (entryCount === 0) return { kind: 'empty' };
  if (directoryOffset + directorySize > file.size) {
    return { kind: 'unreadable', reason: 'corrupted' };
  }

  const directory = await readBytes(file, directoryOffset, directoryOffset + directorySize);
  const entries: DirectoryEntry[] = [];
  let offset = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + CENTRAL_HEADER_SIZE > directory.byteLength ||
      directory.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE
    ) {
      return { kind: 'unreadable', reason: 'corrupted' };
    }
    const flags = directory.getUint16(offset + 8, true);
    const size = directory.getUint32(offset + 24, true);
    const nameLength = directory.getUint16(offset + 28, true);
    const extraLength = directory.getUint16(offset + 30, true);
    const commentLength = directory.getUint16(offset + 32, true);
    const localHeaderOffset = directory.getUint32(offset + 42, true);
    const nameStart = offset + CENTRAL_HEADER_SIZE;
    if (nameStart + nameLength > directory.byteLength) {
      return { kind: 'unreadable', reason: 'corrupted' };
    }
    if (size === 0xffffffff) return { kind: 'unreadable', reason: 'zip64' };

    const nameBytes = new Uint8Array(
      directory.buffer,
      directory.byteOffset + nameStart,
      nameLength,
    );
    const path = decodeName(nameBytes, (flags & UTF8_NAME_FLAG) !== 0);
    entries.push({
      path,
      size,
      isDirectory: path.endsWith('/'),
      centralNameOffset: directoryOffset + nameStart,
      localHeaderOffset,
      nameBytes,
    });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return { kind: 'listed', entries };
}

const LOCAL_HEADER_SIZE = 30;

export type ExtensionFix =
  | { kind: 'fixed'; archive: Blob; renamed: number }
  // Менять нечего или каталог не прочитан.
  | { kind: 'unchanged' }
  // Имя в локальном заголовке не совпало с каталогом: байты менять нельзя.
  | { kind: 'failed' };

// Приводит расширение extension (например, «.dxf») к нижнему регистру в именах записей.
// Расширение из ASCII одинаково в UTF-8 и CP866, а длина имени не меняется: архив не
// пересобирается и не распаковывается — новый Blob составлен из срезов исходного файла и
// заменённых байтов имени в локальных заголовках и центральном каталоге. Данные, методы
// сжатия и CRC остаются прежними, память — по нескольку байтов на запись.
export async function lowercaseExtension(file: Blob, extension: string): Promise<ExtensionFix> {
  const directory = await readDirectory(file);
  if (directory.kind !== 'listed') return { kind: 'unchanged' };
  const target = new TextEncoder().encode(extension.toLowerCase());
  const matches = (bytes: Uint8Array) => {
    if (bytes.length < target.length) return false;
    const tail = bytes.subarray(bytes.length - target.length);
    const lowered = tail.map((byte) => (byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte));
    return (
      lowered.every((byte, index) => byte === target[index]) &&
      !tail.every((byte, index) => byte === target[index])
    );
  };

  const patches: { at: number; bytes: Uint8Array<ArrayBuffer> }[] = [];
  for (const entry of directory.entries) {
    if (entry.isDirectory || !matches(entry.nameBytes)) continue;
    const tailOffset = entry.nameBytes.length - target.length;
    // Имя в локальном заголовке — то же, что в каталоге: проверяем, прежде чем менять.
    const local = new Uint8Array(
      await file
        .slice(
          entry.localHeaderOffset + LOCAL_HEADER_SIZE,
          entry.localHeaderOffset + LOCAL_HEADER_SIZE + entry.nameBytes.length,
        )
        .arrayBuffer(),
    );
    if (!local.every((byte, index) => byte === entry.nameBytes[index])) return { kind: 'failed' };
    patches.push(
      { at: entry.centralNameOffset + tailOffset, bytes: target },
      { at: entry.localHeaderOffset + LOCAL_HEADER_SIZE + tailOffset, bytes: target },
    );
  }
  if (patches.length === 0) return { kind: 'unchanged' };

  patches.sort((a, b) => a.at - b.at);
  const parts: BlobPart[] = [];
  let position = 0;
  for (const { at, bytes } of patches) {
    parts.push(file.slice(position, at), bytes);
    position = at + bytes.length;
  }
  parts.push(file.slice(position));
  return {
    kind: 'fixed',
    archive: new Blob(parts, { type: 'application/zip' }),
    renamed: patches.length / 2,
  };
}

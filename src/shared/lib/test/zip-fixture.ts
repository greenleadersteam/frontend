// Минимальный сборщик ZIP для тестов: записи без сжатия (stored), локальные заголовки,
// центральный каталог и EOCD. CRC не считается: читатель его не проверяет.
// utf8-unflagged — как zip на macOS и Linux: имя в UTF-8, но без флага UTF-8.
export type TestZipEntry = {
  name: string;
  data?: string;
  encoding?: 'utf8' | 'utf8-unflagged' | 'cp866';
};

const CP866_UPPER = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';
const CP866_LOWER_A = 'абвгдежзийклмноп';
const CP866_LOWER_R = 'рстуфхцчшщъыьэюя';

function encodeCp866(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Array.from(text), (char) => {
    const upper = CP866_UPPER.indexOf(char);
    if (upper >= 0) return 0x80 + upper;
    const lowerA = CP866_LOWER_A.indexOf(char);
    if (lowerA >= 0) return 0xa0 + lowerA;
    const lowerR = CP866_LOWER_R.indexOf(char);
    if (lowerR >= 0) return 0xe0 + lowerR;
    if (char === 'Ё') return 0xf0;
    if (char === 'ё') return 0xf1;
    return char.charCodeAt(0);
  });
}

// Поля, которые в ZIP64 заменяются на 0xFFFF…: число записей, смещение каталога, размер записи.
type Zip64Field = 'entries' | 'offset' | 'entry-size';

export function buildZip(
  entries: TestZipEntry[],
  { comment = '', zip64 }: { comment?: string; zip64?: Zip64Field } = {},
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const { name, data = '', encoding = 'utf8' } of entries) {
    const nameBytes = encoding === 'cp866' ? encodeCp866(name) : encoder.encode(name);
    const body = encoder.encode(data);
    const flags = encoding === 'utf8' ? 1 << 11 : 0;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(6, flags, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, body.length, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, body);

    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(8, flags, true);
    header.setUint32(20, body.length, true);
    header.setUint32(24, zip64 === 'entry-size' ? 0xffffffff : body.length, true);
    header.setUint16(28, nameBytes.length, true);
    header.setUint32(42, offset, true);
    central.push(new Uint8Array(header.buffer), nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }

  const directorySize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const commentBytes = encoder.encode(comment);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, zip64 === 'entries' ? 0xffff : entries.length, true);
  eocd.setUint16(10, zip64 === 'entries' ? 0xffff : entries.length, true);
  eocd.setUint32(12, directorySize, true);
  eocd.setUint32(16, zip64 === 'offset' ? 0xffffffff : offset, true);
  eocd.setUint16(20, commentBytes.length, true);

  const parts = [...chunks, ...central, new Uint8Array(eocd.buffer), commentBytes];
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of parts) {
    result.set(part, position);
    position += part.length;
  }
  return result;
}

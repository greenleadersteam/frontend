import { describe, expect, test } from 'vitest';

import { MAX_ARCHIVE_BYTES } from '@/shared/api';
import { buildZip } from '@/shared/lib/test';

import { checkSelection } from './check-archive';

// Файл «больше лимита» без выделения 100 МБ: проверка смотрит только на size.
const oversized = (name: string) => {
  const file = new File(['x'], name);
  Object.defineProperty(file, 'size', { value: MAX_ARCHIVE_BYTES + 1 });
  return file;
};

const zipFile = (entries: Parameters<typeof buildZip>[0], name = 'site.zip') =>
  new File([buildZip(entries)], name);

const checkArchive = (file: File) => checkSelection([file]);

describe('checkSelection', () => {
  test.each([
    ['не ZIP и не DXF', new File(['x'], 'site.rar'), /^Сервер читает только DXF, а „site\.rar“/],
    ['больше лимита', oversized('big.zip'), /^Архив больше 100\u00A0МБ\./],
    ['не ZIP по сигнатуре', new File(['%PDF-1.7'], 'site.zip'), /^Файл не похож на архив ZIP/],
    ['пустой архив', zipFile([]), /^Архив пустой\./],
    ['нет DXF', zipFile([{ name: 'readme.txt' }]), /^В архиве нет чертежей DXF\./],
  ])('%s — отказ', async (_, file, message) => {
    const result = await checkArchive(file);

    expect(result.kind).toBe('rejected');
    expect(result.kind === 'rejected' && result.message).toMatch(message);
  });

  test('ZIP вместе с другими файлами — отказ', async () => {
    const result = await checkSelection([zipFile([{ name: 'a.dxf' }]), new File(['x'], 'b.dxf')]);

    expect(result).toEqual({
      kind: 'rejected',
      message: 'Загрузите либо один ZIP, либо отдельные файлы.',
    });
  });

  test('отдельные DXF упаковываются в архив', async () => {
    const result = await checkSelection([new File(['x'], 'a.dxf'), new File(['y'], 'b.dxf')]);

    expect(result).toMatchObject({ kind: 'accepted', archive: { packed: true } });
  });

  test('архив с DXF (в том числе .DXF) принят со списком файлов', async () => {
    const result = await checkArchive(
      zipFile([{ name: 'ГП/Генплан.DXF' }, { name: 'ГП/сети.dwg' }]),
    );

    expect(result.kind === 'accepted' && result.archive.entries?.map(({ path }) => path)).toEqual([
      'ГП/Генплан.DXF',
      'ГП/сети.dwg',
    ]);
  });

  test('ZIP64 — принят без списка: решение за сервером', async () => {
    const bytes = buildZip([{ name: 'a.dxf' }]);
    new DataView(bytes.buffer).setUint16(bytes.length - 12, 0xffff, true);

    const result = await checkArchive(new File([bytes], 'big.zip'));

    expect(result).toMatchObject({ kind: 'accepted', archive: { packed: false, entries: null } });
  });
});

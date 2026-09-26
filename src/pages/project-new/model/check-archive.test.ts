import { describe, expect, test } from 'vitest';

import { MAX_ARCHIVE_BYTES } from '@/shared/api';
import { buildZip } from '@/shared/lib/test';

import { checkArchive } from './check-archive';

// Файл «больше лимита» без выделения 100 МБ: проверка смотрит только на size.
const oversized = (name: string) => {
  const file = new File(['x'], name);
  Object.defineProperty(file, 'size', { value: MAX_ARCHIVE_BYTES + 1 });
  return file;
};

const zipFile = (entries: Parameters<typeof buildZip>[0], name = 'site.zip') =>
  new File([buildZip(entries)], name);

describe('checkArchive', () => {
  test.each([
    ['не .zip', new File(['x'], 'site.rar'), /^Нужен архив ZIP\./],
    ['больше лимита', oversized('big.zip'), /^Архив больше 100\u00A0МБ\./],
    ['не ZIP по сигнатуре', new File(['%PDF-1.7'], 'site.zip'), /^Файл не похож на архив ZIP/],
    ['пустой архив', zipFile([]), /^Архив пустой\./],
    ['нет DXF', zipFile([{ name: 'readme.txt' }]), /^В архиве нет чертежей DXF\./],
  ])('%s — отказ', async (_, file, message) => {
    const result = await checkArchive(file);

    expect(result.kind).toBe('rejected');
    expect(result.kind === 'rejected' && result.message).toMatch(message);
  });

  test('проверки по порядку: расширение раньше размера', async () => {
    const result = await checkArchive(oversized('big.rar'));

    expect(result.kind === 'rejected' && result.message).toMatch(/^Нужен архив ZIP/);
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

    expect(result).toMatchObject({ kind: 'accepted', archive: { entries: null } });
  });
});

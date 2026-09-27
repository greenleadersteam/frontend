import { describe, expect, test, vi } from 'vitest';

import type * as Api from '@/shared/api';
import { readZipListing } from '@/shared/lib/zip';

import { packFiles } from './pack-files';

// Лимит в 400 байт: и ранняя, и окончательная проверка размера — без выделения 100 МБ.
vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  MAX_ARCHIVE_BYTES: 400,
}));

const dxf = (name: string, data = '0\nSECTION') => new File([data], name);

const packed = async (files: File[]) => {
  const result = await packFiles(files);
  if (result.kind !== 'accepted') throw new Error(`отказ: ${result.message}`);
  return result.archive;
};

const rejection = async (files: File[]) => {
  const result = await packFiles(files);
  return result.kind === 'rejected' ? result.message : null;
};

describe('packFiles', () => {
  test('собранный архив читается нашим же разбором ZIP: имена без путей, размеры', async () => {
    const archive = await packed([dxf('Генплан.dxf'), dxf('Сети.dxf', '0\nSECTION\n2\nHEADER')]);

    const listing = await readZipListing(archive.file);

    expect(listing).toMatchObject({
      kind: 'listed',
      entries: [
        { path: 'Генплан.dxf', size: 9, isDirectory: false },
        { path: 'Сети.dxf', size: 18, isDirectory: false },
      ],
    });
    expect(archive).toMatchObject({
      packed: true,
      entries: [{ path: 'Генплан.dxf' }, { path: 'Сети.dxf' }],
    });
    expect(archive.file.type).toBe('application/zip');
  });

  test('кириллица — в UTF-8 с битом 11, файлы без сжатия', async () => {
    const archive = await packed([dxf('План.dxf')]);
    const bytes = new DataView(await archive.file.arrayBuffer());

    expect(bytes.getUint32(0, true)).toBe(0x04034b50);
    expect(bytes.getUint16(6, true) & (1 << 11)).not.toBe(0);
    // Метод 0 — stored: бэкенд распаковывает без inflate.
    expect(bytes.getUint16(8, true)).toBe(0);
    expect(archive.file.name).toBe('План.zip');
  });

  test('расширение .DXF приводится к .dxf: сервер ищет файлы с учётом регистра', async () => {
    const archive = await packed([dxf('ПЛАН.DXF'), dxf('сети.Dxf')]);

    expect(archive.entries?.map(({ path }) => path)).toEqual(['ПЛАН.dxf', 'сети.dxf']);
    expect(archive.file.name).toBe('files.zip');
  });

  test('повторяющиеся имена без учёта регистра — отказ', async () => {
    expect(await rejection([dxf('План.dxf'), dxf('План.dxf')])).toBe(
      'Два файла с именем „План.dxf“. Оставьте один.',
    );
    expect(await rejection([dxf('План.dxf'), dxf('ПЛАН.DXF')])).toBe(
      '„План.dxf“ и „ПЛАН.DXF“ сервер считает одним файлом. Оставьте один.',
    );
  });

  test('пустой выбор — отказ', async () => {
    expect(await rejection([])).toMatch(/^Файлы не выбраны\./);
  });

  test('не DXF — отказ: другие файлы сервер не читает', async () => {
    expect(await rejection([dxf('План.dxf'), new File(['x'], 'сети.dwg')])).toBe(
      'Сервер читает только DXF, а „сети.dwg“ — не DXF. Уберите файл или сохраните чертёж в DXF.',
    );
  });

  test('сумма размеров больше лимита — отказ до чтения файлов', async () => {
    const big = dxf('План.dxf');
    Object.defineProperty(big, 'size', { value: 401 });
    const read = vi.spyOn(big, 'arrayBuffer');

    expect(await rejection([big])).toMatch(/^Выбранные файлы больше /);
    expect(read).not.toHaveBeenCalled();
  });

  test('лимит — по готовому архиву: заголовки ZIP тоже в счёт', async () => {
    // 350 байт данных проходят раннюю проверку, но с заголовками архив больше 400 байт.
    expect(await rejection([dxf('a.dxf', 'x'.repeat(350))])).toMatch(/^Выбранные файлы больше /);
  });
});

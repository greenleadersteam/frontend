import { describe, expect, test } from 'vitest';

import { buildZip } from '@/shared/lib/test';

import { readZipListing } from './zip';

const blob = (bytes: Uint8Array<ArrayBuffer>) => new Blob([bytes]);

describe('readZipListing', () => {
  test('обычный архив — записи, число файлов, размер', async () => {
    const zip = buildZip([
      { name: 'ГП/' },
      { name: 'ГП/Генплан.dxf', data: '0\nSECTION' },
      { name: 'ГП/сети.dxf', data: 'abc' },
    ]);

    await expect(readZipListing(blob(zip))).resolves.toEqual({
      kind: 'listed',
      entries: [
        { path: 'ГП/', size: 0, isDirectory: true },
        { path: 'ГП/Генплан.dxf', size: 9, isDirectory: false },
        { path: 'ГП/сети.dxf', size: 3, isDirectory: false },
      ],
      fileCount: 2,
      totalSize: 12,
    });
  });

  test('имена в CP866 без флага UTF-8 читаются по-русски', async () => {
    const zip = buildZip([{ name: 'Подоснова/Генплан_изм2.dxf', encoding: 'cp866' }]);

    const listing = await readZipListing(blob(zip));
    expect(listing.kind === 'listed' && listing.entries[0]?.path).toBe(
      'Подоснова/Генплан_изм2.dxf',
    );
  });

  test('имена в UTF-8 с флагом', async () => {
    const zip = buildZip([{ name: 'Ёлки/сквер.dxf', encoding: 'utf8' }]);

    const listing = await readZipListing(blob(zip));
    expect(listing.kind === 'listed' && listing.entries[0]?.path).toBe('Ёлки/сквер.dxf');
  });

  test('имена в UTF-8 без флага (zip на macOS и Linux)', async () => {
    const zip = buildZip([{ name: 'ГП/Генплан.dxf', encoding: 'utf8-unflagged' }]);

    const listing = await readZipListing(blob(zip));
    expect(listing.kind === 'listed' && listing.entries[0]?.path).toBe('ГП/Генплан.dxf');
  });

  test('пустой архив', async () => {
    await expect(readZipListing(blob(buildZip([])))).resolves.toEqual({ kind: 'empty' });
  });

  test('не ZIP', async () => {
    await expect(readZipListing(new Blob(['%PDF-1.7 not a zip']))).resolves.toEqual({
      kind: 'not-zip',
    });
    await expect(readZipListing(new Blob(['PK']))).resolves.toEqual({ kind: 'not-zip' });
  });

  test('обрезанный файл — список не прочитан', async () => {
    const zip = buildZip([{ name: 'a.dxf', data: 'x'.repeat(100) }]);

    await expect(readZipListing(blob(zip.slice(0, 80)))).resolves.toEqual({
      kind: 'unreadable',
      reason: 'corrupted',
    });
  });

  test('каталог указывает за пределы файла', async () => {
    const zip = buildZip([{ name: 'a.dxf' }]);
    new DataView(zip.buffer).setUint32(zip.length - 6, 10_000, true);

    await expect(readZipListing(blob(zip))).resolves.toEqual({
      kind: 'unreadable',
      reason: 'corrupted',
    });
  });

  test('комментарий в EOCD, в том числе с байтами, похожими на сигнатуру', async () => {
    // Поддельная сигнатура с 22+ байтами после неё: без проверки длины комментария
    // читатель принял бы её за EOCD.
    const fake = `PK\u0005\u0006${'\u0000'.repeat(24)}`;
    const zip = buildZip([{ name: 'a.dxf' }], { comment: `Архив ДПиООС ${fake}` });

    const listing = await readZipListing(blob(zip));
    expect(listing.kind === 'listed' && listing.entries.map(({ path }) => path)).toEqual(['a.dxf']);
  });

  test.each(['entries', 'offset', 'entry-size'] as const)('признак ZIP64 (%s)', async (field) => {
    const zip = buildZip([{ name: 'a.dxf' }], { zip64: field });

    await expect(readZipListing(blob(zip))).resolves.toEqual({
      kind: 'unreadable',
      reason: 'zip64',
    });
  });
});

import { MAX_ARCHIVE_BYTES } from '@/shared/api';
import { formatFileSize } from '@/shared/lib/format';
import { readZipListing, type ZipEntry } from '@/shared/lib/zip';

import { packFiles } from './pack-files';

export type CheckedArchive = {
  // Тело загрузки: выбранный ZIP или архив, собранный браузером из отдельных файлов.
  file: File;
  packed: boolean;
  // null — список файлов прочитать не удалось (ZIP64, повреждённый каталог): архив
  // пропускается с предупреждением, решение принимает сервер.
  entries: ZipEntry[] | null;
};

export type ArchiveCheck =
  { kind: 'accepted'; archive: CheckedArchive } | { kind: 'rejected'; message: string };

const isDxf = (path: string) => path.toLowerCase().endsWith('.dxf');
const isZip = (file: File) => file.name.toLowerCase().endsWith('.zip');

export const dxfEntriesOf = <Entry extends ZipEntry>(entries: Entry[]): Entry[] =>
  entries.filter(({ path, isDirectory }) => !isDirectory && isDxf(path));

// Один ZIP загружается как есть, отдельные файлы браузер упаковывает сам.
export function checkSelection(files: File[]): Promise<ArchiveCheck> {
  const [single] = files;
  if (files.length === 1 && single !== undefined && isZip(single)) return checkArchive(single);
  if (files.some(isZip)) {
    return Promise.resolve({
      kind: 'rejected',
      message: 'Загрузите либо один ZIP, либо отдельные файлы.',
    });
  }
  return packFiles(files);
}

// Проверки по порядку, первая ошибка останавливает (security.md, «Загрузка архива»).
// Клиентская проверка — для удобства; окончательное решение принимает сервер.
async function checkArchive(file: File): Promise<ArchiveCheck> {
  if (file.size > MAX_ARCHIVE_BYTES) {
    return {
      kind: 'rejected',
      message: `Архив больше ${formatFileSize(MAX_ARCHIVE_BYTES)}. Уменьшите архив или уберите из него лишние файлы.`,
    };
  }

  const listing = await readZipListing(file);
  switch (listing.kind) {
    case 'not-zip':
      return {
        kind: 'rejected',
        message: 'Файл не похож на архив ZIP или повреждён. Проверьте файл и выберите его снова.',
      };
    case 'empty':
      return {
        kind: 'rejected',
        message:
          'Архив пустой. Добавьте в него главный чертёж генплана в DXF и выберите архив снова.',
      };
    case 'unreadable':
      return { kind: 'accepted', archive: { file, packed: false, entries: null } };
    case 'listed':
      if (dxfEntriesOf(listing.entries).length === 0) {
        return {
          kind: 'rejected',
          message:
            'В архиве нет чертежей DXF. Добавьте главный чертёж генплана в DXF и выберите архив снова.',
        };
      }
      return { kind: 'accepted', archive: { file, packed: false, entries: listing.entries } };
    default: {
      const unexpected: never = listing;
      return unexpected;
    }
  }
}

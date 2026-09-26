import { MAX_ARCHIVE_BYTES } from '@/shared/api';
import { formatFileSize } from '@/shared/lib/format';
import { readZipListing, type ZipEntry } from '@/shared/lib/zip';

export type CheckedArchive = {
  file: File;
  // null — список файлов прочитать не удалось (ZIP64, повреждённый каталог): архив
  // пропускается с предупреждением, решение принимает сервер.
  entries: ZipEntry[] | null;
};

export type ArchiveCheck =
  { kind: 'accepted'; archive: CheckedArchive } | { kind: 'rejected'; message: string };

const isDxf = (path: string) => path.toLowerCase().endsWith('.dxf');

export const dxfEntriesOf = <Entry extends ZipEntry>(entries: Entry[]): Entry[] =>
  entries.filter(({ path, isDirectory }) => !isDirectory && isDxf(path));

// Проверки по порядку, первая ошибка останавливает (security.md, «Загрузка архива»).
// Клиентская проверка — для удобства; окончательное решение принимает сервер.
export async function checkArchive(file: File): Promise<ArchiveCheck> {
  if (!file.name.toLowerCase().endsWith('.zip')) {
    return {
      kind: 'rejected',
      message: 'Нужен архив ZIP. Упакуйте файлы в ZIP и выберите его снова.',
    };
  }
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
        message: 'Архив пустой. Добавьте в него главный DXF генплана и выберите архив снова.',
      };
    case 'unreadable':
      return { kind: 'accepted', archive: { file, entries: null } };
    case 'listed':
      if (dxfEntriesOf(listing.entries).length === 0) {
        return {
          kind: 'rejected',
          message:
            'В архиве нет чертежей DXF. Добавьте главный DXF генплана и загрузите архив снова.',
        };
      }
      return { kind: 'accepted', archive: { file, entries: listing.entries } };
    default: {
      const unexpected: never = listing;
      return unexpected;
    }
  }
}

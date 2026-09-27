import { zipSync } from 'fflate';

import { MAX_ARCHIVE_BYTES } from '@/shared/api';
import { formatFileSize } from '@/shared/lib/format';

import type { ArchiveCheck } from './check-archive';

const DXF_EXTENSION = /\.dxf$/i;

// Бэкенд принимает только ZIP (../backend/greenplan/api/app.py:97-135), поэтому отдельные
// файлы упаковывает браузер. Из архива бэкенд читает только *.dxf — главный чертёж и
// внешние ссылки, которые ищет по имени без расширения среди тех же *.dxf
// (../backend/greenplan/io/dxf_source.py:41-45, 123-128). Остальные файлы он не читает.
export async function packFiles(files: File[]): Promise<ArchiveCheck> {
  if (files.length === 0) {
    return { kind: 'rejected', message: 'Файлы не выбраны. Выберите ZIP или чертежи DXF.' };
  }
  const foreign = files.find(({ name }) => !DXF_EXTENSION.test(name));
  if (foreign !== undefined) {
    return {
      kind: 'rejected',
      message: `Сервер читает только DXF, а „${foreign.name}“ — не DXF. Уберите файл или сохраните чертёж в DXF.`,
    };
  }

  // rglob("*.dxf") на Linux различает регистр: «ПЛАН.DXF» сервер не найдёт. Внешние ссылки
  // он сопоставляет без учёта регистра, поэтому «План.dxf» и «ПЛАН.DXF» для него — один файл.
  const named = files.map((file) => ({ file, name: file.name.replace(DXF_EXTENSION, '.dxf') }));
  const seen = new Map<string, string>();
  for (const { file, name } of named) {
    const key = name.toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) {
      return {
        kind: 'rejected',
        message:
          first === file.name
            ? `Два файла с именем „${file.name}“. Оставьте один.`
            : `„${first}“ и „${file.name}“ сервер считает одним файлом. Оставьте один.`,
      };
    }
    seen.set(key, file.name);
  }

  // Ранняя проверка до чтения файлов; окончательная — по готовому архиву.
  const tooLarge = `Выбранные файлы больше ${formatFileSize(MAX_ARCHIVE_BYTES)}. Уберите лишние файлы.`;
  if (files.reduce((sum, { size }) => sum + size, 0) > MAX_ARCHIVE_BYTES) {
    return { kind: 'rejected', message: tooLarge };
  }

  const contents = await Promise.all(
    named.map(async ({ file, name }) => [name, new Uint8Array(await file.arrayBuffer())] as const),
  );
  // Без сжатия: бэкенду важна скорость распаковки, а DXF сжимают сервер и сеть. Имена
  // fflate пишет в UTF-8 и ставит бит 11, если в имени есть символы вне ASCII.
  const bytes = zipSync(Object.fromEntries(contents), { level: 0 });
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) return { kind: 'rejected', message: tooLarge };

  const [single] = named;
  const archiveName =
    named.length === 1 && single !== undefined
      ? single.name.replace(DXF_EXTENSION, '.zip')
      : 'files.zip';
  return {
    kind: 'accepted',
    archive: {
      file: new File([bytes], archiveName, { type: 'application/zip' }),
      packed: true,
      entries: named.map(({ file, name }) => ({ path: name, size: file.size, isDirectory: false })),
    },
  };
}

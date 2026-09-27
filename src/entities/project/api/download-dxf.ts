import { type AppError, toAppError } from '@/shared/api';
import { getRuntimeConfig } from '@/shared/config';
import { saveFile } from '@/shared/lib/save-file';

import { projectFileName } from '../lib/file-name';
import type { Project } from '../model/project';

// Вариант результата при возможности editedDxf: с правками (по умолчанию) или исходный
// результат обработки (?variant=original, contracts/openapi.proposed.yaml).
export type DxfVariant = 'edited' | 'original';

// Через RTK Query не идёт: Blob не сериализуется, а кэшировать файл незачем.
export async function downloadProjectDxf(
  { id, name }: Pick<Project, 'id' | 'name'>,
  variant: DxfVariant = 'edited',
): Promise<AppError | null> {
  let file: Blob;
  const query = variant === 'original' ? '?variant=original' : '';
  try {
    const response = await fetch(
      `${getRuntimeConfig().apiBaseUrl}/projects/${encodeURIComponent(id)}/dxf${query}`,
    );
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      return toAppError({ status: response.status, data: body });
    }
    file = await response.blob();
  } catch {
    return { kind: 'network' };
  }

  saveFile(
    file,
    projectFileName(name, variant === 'original' ? ' — исходный результат.dxf' : '.dxf'),
  );
  return null;
}

import { type AppError, toAppError } from '@/shared/api';
import { getRuntimeConfig } from '@/shared/config';
import { saveFile } from '@/shared/lib/save-file';

import { projectFileName } from '../lib/file-name';
import type { Project } from '../model/project';

// Через RTK Query не идёт: Blob не сериализуется, а кэшировать файл незачем.
export async function downloadProjectDxf({
  id,
  name,
}: Pick<Project, 'id' | 'name'>): Promise<AppError | null> {
  let file: Blob;
  try {
    const response = await fetch(
      `${getRuntimeConfig().apiBaseUrl}/projects/${encodeURIComponent(id)}/dxf`,
    );
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      return toAppError({ status: response.status, data: body });
    }
    file = await response.blob();
  } catch {
    return { kind: 'network' };
  }

  saveFile(file, projectFileName(name, '.dxf'));
  return null;
}

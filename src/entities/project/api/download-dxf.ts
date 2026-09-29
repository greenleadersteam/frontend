import { type AppError, toAppError } from '@/shared/api';
import { getRuntimeConfig } from '@/shared/config';
import { saveFile } from '@/shared/lib/save-file';

import { projectFileName } from '../lib/file-name';
import type { Project } from '../model/project';

// Версия плана посадок при возможности editedDxf (?version=, contracts/openapi.proposed.yaml);
// null — /dxf без параметра. Суффикс имени файла отличает версии между собой.
export type DxfVersion = { version: number; fileSuffix: string };

// Через RTK Query не идёт: Blob не сериализуется, а кэшировать файл незачем.
export async function downloadProjectDxf(
  { id, name }: Pick<Project, 'id' | 'name'>,
  version: DxfVersion | null = null,
): Promise<AppError | null> {
  let file: Blob;
  const query = version === null ? '' : `?version=${String(version.version)}`;
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

  saveFile(file, projectFileName(name, version === null ? '.dxf' : version.fileSuffix));
  return null;
}

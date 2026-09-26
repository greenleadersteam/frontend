import { type AppError, toAppError } from '@/shared/api';
import { getRuntimeConfig } from '@/shared/config';

import type { Project } from '../model/project';

// Символы, недопустимые в именах файлов Windows и Linux, и управляющие (security.md, «Скачивание»).
// eslint-disable-next-line no-control-regex -- управляющие символы и ищем
const FORBIDDEN_CHARACTERS = /[/\\:*?"<>|\u0000-\u001F\u007F]/g;
// Кириллица в UTF-8 — два байта на символ: 120 символов с «.dxf» укладываются в 255 байт,
// предел имени файла в ext4 и NTFS.
const MAX_NAME_LENGTH = 120;
const FALLBACK_NAME = 'план посадок';

// Content-Disposition бэкенда сейчас всегда «planting.dxf» (задача P2-2), поэтому имя
// файла строится из названия проекта.
export function dxfFileName(projectName: string): string {
  const cleaned = projectName.replace(/\s+/g, ' ').replace(FORBIDDEN_CHARACTERS, '_').trim();
  // Windows не сохраняет файл с точкой или пробелом в конце имени.
  const name = Array.from(cleaned)
    .slice(0, MAX_NAME_LENGTH)
    .join('')
    .replace(/[. ]+$/, '');
  return `${name === '' ? FALLBACK_NAME : name}.dxf`;
}

// Время на то, чтобы браузер начал сохранение, прежде чем объектный URL освободится:
// Firefox читает blob после возврата из click().
const REVOKE_DELAY_MS = 10_000;

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

  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = dxfFileName(name);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, REVOKE_DELAY_MS);
  return null;
}

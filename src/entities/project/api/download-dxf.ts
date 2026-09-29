import { describeAppError, toAppError } from '@/shared/api';
import { getRuntimeConfig } from '@/shared/config';
import { saveFile } from '@/shared/lib/save-file';

import { projectFileName } from '../lib/file-name';
import type { Project } from '../model/project';

// Версия плана посадок: DXF версии — /plantings/{version}/dxf (../backend/greenplan/api/app.py,
// get_planting_version_dxf); null — /dxf, последняя версия. Суффикс имени файла отличает
// версии между собой.
export type DxfVersion = { version: number; fileSuffix: string };

export type DxfResult =
  | { kind: 'file'; file: Blob }
  | { kind: 'error'; message: string }
  // Ожидание отменено: уход с экрана — ничего не сохраняется и не сообщается.
  | { kind: 'aborted' };

type DxfOptions = {
  signal?: AbortSignal;
  // Первый ответ 202: сервер собирает файл, ожидание будет заметным.
  onPending?: () => void;
};

// DXF правленой версии сервер собирает в фоне и до готовности отвечает 202 с Retry-After
// (app.py, _version_file). Столько клиент ждёт, прежде чем попросить повторить позже.
const EXPORT_WAIT_MS = 180_000;
const DEFAULT_RETRY_S = 5;

const EXPORT_PENDING = 'DXF версии ещё собирается на сервере. Повторите скачивание через минуту.';
const TRANSFORM_UNAVAILABLE =
  'Проект обработан до появления версий: DXF есть только у расстановки сервиса. Выберите версию 1 в поле «Версия:» и скачайте её.';
const EXPORT_FAILED =
  'Сервер не смог собрать DXF этой версии. Скачайте расстановку сервиса или сообщите администратору.';

const delay = (ms: number, signal: AbortSignal | undefined) =>
  new Promise<void>((resolve) => {
    const abort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });

const retryAfterMs = (response: Response): number => {
  const seconds = Number(response.headers.get('Retry-After'));
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_RETRY_S) * 1000;
};

// 409 и 500 у DXF версии — detail с кодом (ErrorWithCode в OpenAPI бэкенда).
function errorCode(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || !('detail' in body)) return undefined;
  const { detail } = body;
  if (typeof detail !== 'object' || detail === null || !('code' in detail)) return undefined;
  return detail.code;
}

// DXF сервера файлом. Через RTK Query не идёт: Blob не сериализуется, а кэшировать файл незачем.
export async function fetchProjectDxf(
  id: string,
  version: number | null = null,
  { signal, onPending }: DxfOptions = {},
): Promise<DxfResult> {
  const path = version === null ? 'dxf' : `plantings/${String(version)}/dxf`;
  const url = `${getRuntimeConfig().apiBaseUrl}/projects/${encodeURIComponent(id)}/${path}`;
  const started = Date.now();
  let pending = false;
  try {
    for (;;) {
      const response = await fetch(url, { signal });
      if (response.status === 202) {
        if (!pending) onPending?.();
        pending = true;
        const wait = retryAfterMs(response);
        if (Date.now() - started + wait > EXPORT_WAIT_MS) {
          return { kind: 'error', message: EXPORT_PENDING };
        }
        await delay(wait, signal);
        if (signal?.aborted === true) return { kind: 'aborted' };
        continue;
      }
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const code = errorCode(body);
        if (code === 'transform_unavailable')
          return { kind: 'error', message: TRANSFORM_UNAVAILABLE };
        if (code === 'export_failed') return { kind: 'error', message: EXPORT_FAILED };
        return {
          kind: 'error',
          message: describeAppError(toAppError({ status: response.status, data: body })),
        };
      }
      return { kind: 'file', file: await response.blob() };
    }
  } catch {
    if (signal?.aborted === true) return { kind: 'aborted' };
    return { kind: 'error', message: describeAppError({ kind: 'network' }) };
  }
}

// Сообщение для пользователя, если файл не скачан; null — скачан или ожидание отменено.
export async function downloadProjectDxf(
  { id, name }: Pick<Project, 'id' | 'name'>,
  version: DxfVersion | null = null,
  options: DxfOptions = {},
): Promise<string | null> {
  const result = await fetchProjectDxf(id, version?.version ?? null, options);
  switch (result.kind) {
    case 'error':
      return result.message;
    case 'aborted':
      return null;
    case 'file':
      saveFile(result.file, projectFileName(name, version === null ? '.dxf' : version.fileSuffix));
      return null;
    default: {
      const unexpected: never = result;
      return unexpected;
    }
  }
}

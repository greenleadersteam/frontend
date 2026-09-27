import type { SerializedError } from '@reduxjs/toolkit';
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';

import { formatFileSize } from '@/shared/lib/format';

import { MAX_ARCHIVE_BYTES } from './archive-limit';

export type AppError =
  | { kind: 'network' }
  | { kind: 'timeout' }
  | { kind: 'http'; status: number; message: string | null }
  | { kind: 'validation'; fields: Record<string, string> }
  | { kind: 'unknown' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// FastAPI отдаёт 422 как { detail: [{ loc, msg, type }] }. Поле — последний строковый элемент loc:
// в ['body', 'files', 0] числа — индексы элементов списка, а поле формы — 'files'.
function toValidationFields(detail: unknown): Record<string, string> | null {
  if (!Array.isArray(detail) || detail.length === 0) return null;
  const items: unknown[] = detail;
  const fields: Record<string, string> = {};
  for (const item of items) {
    if (!isRecord(item) || !Array.isArray(item.loc) || typeof item.msg !== 'string') return null;
    const loc: unknown[] = item.loc;
    const field = loc.findLast((part) => typeof part === 'string');
    if (typeof field !== 'string') return null;
    fields[field] ??= item.msg;
  }
  return fields;
}

function fromHttpStatus(status: number, body: unknown): AppError {
  const detail = isRecord(body) ? body.detail : undefined;
  if (status === 422) {
    const fields = toValidationFields(detail);
    if (fields !== null) return { kind: 'validation', fields };
  }
  return { kind: 'http', status, message: typeof detail === 'string' ? detail : null };
}

export function toAppError(error: FetchBaseQueryError | SerializedError | undefined): AppError {
  if (error === undefined || !('status' in error)) return { kind: 'unknown' };
  if (typeof error.status === 'number') return fromHttpStatus(error.status, error.data);
  switch (error.status) {
    case 'FETCH_ERROR':
      return { kind: 'network' };
    case 'TIMEOUT_ERROR':
      return { kind: 'timeout' };
    case 'PARSING_ERROR':
      // Неразбираемое тело при успешном статусе — не отказ сервера, а расхождение с контрактом.
      return error.originalStatus >= 400
        ? { kind: 'http', status: error.originalStatus, message: null }
        : { kind: 'unknown' };
    case 'CUSTOM_ERROR':
      return { kind: 'unknown' };
    default: {
      const unexpected: never = error;
      return unexpected;
    }
  }
}

// МиБ показываются как «МБ»: так их называет copy.md, а лимит бэкенда задан в МиБ.
function describeHttpStatus(status: number): string {
  if (status === 404) return 'Данные не найдены: возможно, их удалили. Обновите страницу.';
  if (status === 409) {
    return 'Действие недоступно в текущем состоянии проекта. Обновите страницу и проверьте статус.';
  }
  if (status === 413) {
    return `Архив больше ${formatFileSize(MAX_ARCHIVE_BYTES)}. Уменьшите архив или уберите из него лишние файлы.`;
  }
  if (status === 429) return 'Сервер обрабатывает другие проекты. Повторите через минуту.';
  if (status >= 500) {
    return 'Сервер не смог обработать запрос. Повторите попытку позже. Если ошибка повторяется, сообщите администратору.';
  }
  return 'Сервер отклонил запрос. Обновите страницу и повторите попытку.';
}

// Сообщение сервера (error.message) пользователю не показывается: это внутренний текст бэкенда.
export function describeAppError(error: AppError): string {
  switch (error.kind) {
    case 'network':
      return 'Нет связи с сервером. Проверьте подключение и повторите попытку.';
    case 'timeout':
      return 'Сервер не ответил вовремя. Повторите попытку позже.';
    case 'http':
      return describeHttpStatus(error.status);
    case 'validation':
      return 'Сервер не принял данные. Проверьте отмеченные поля и повторите попытку.';
    case 'unknown':
      return 'Что-то пошло не так. Обновите страницу. Если ошибка повторяется, сообщите администратору.';
    default: {
      const unexpected: never = error;
      return unexpected;
    }
  }
}

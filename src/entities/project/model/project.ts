import type { SerializedError } from '@reduxjs/toolkit';
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';

import {
  type ApiComponents,
  type AppError,
  type ProposedApiComponents,
  toAppError,
} from '@/shared/api';

export type ProjectResponse = ApiComponents['schemas']['ProjectResponse'];
export type Job = ApiComponents['schemas']['JobStatus'];
export type JobError = ApiComponents['schemas']['JobError'];
export type UploadErrorCode = ApiComponents['schemas']['UploadErrorCode'];

// Значения статуса есть только в контракте-предложении: в спецификации бэкенда это строка.
type KnownStatus = ProposedApiComponents['schemas']['ProjectStatus'];
export type ProcessingStage = Exclude<KnownStatus, 'draft' | 'ready' | 'failed'>;

export type ProjectState =
  | { kind: 'draft' }
  | { kind: 'processing'; stage: ProcessingStage }
  | { kind: 'ready' }
  | { kind: 'failed'; error: JobError | null }
  | { kind: 'unknown' };

export type Project = Omit<ProjectResponse, 'status'> & { state: ProjectState };

// Порядок этапов обработки у бэкенда: ../backend/greenplan/api/jobs.py:40-48.
export const PROCESSING_STAGES = [
  'queued',
  'extracting',
  'parsing',
  'georeferencing',
  'zoning_layout',
  'exporting',
] as const satisfies readonly ProcessingStage[];

// Формат id бэкенд не документирует; реальные id — 32 hex-символа, правило взято с запасом.
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

// Параметры маршрута и адреса — недоверенные данные: проверяются до запроса.
export const isProjectId = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && PROJECT_ID_PATTERN.test(value);

// satisfies требует все значения контракта: новый статус без разбора ниже — ошибка типов.
const KNOWN_STATUSES = {
  draft: true,
  queued: true,
  extracting: true,
  parsing: true,
  georeferencing: true,
  zoning_layout: true,
  exporting: true,
  ready: true,
  failed: true,
} satisfies Record<KnownStatus, true>;

const isKnownStatus = (status: string): status is KnownStatus =>
  Object.hasOwn(KNOWN_STATUSES, status);

export function parseProjectState(status: string, job: Job): ProjectState {
  if (!isKnownStatus(status)) return { kind: 'unknown' };
  switch (status) {
    case 'draft':
      return { kind: 'draft' };
    case 'ready':
      return { kind: 'ready' };
    case 'failed':
      return { kind: 'failed', error: job.error ?? null };
    case 'queued':
    case 'extracting':
    case 'parsing':
    case 'georeferencing':
    case 'zoning_layout':
    case 'exporting':
      return { kind: 'processing', stage: status };
    default: {
      const unexpected: never = status;
      return unexpected;
    }
  }
}

export const toProject = ({ status, ...project }: ProjectResponse): Project => ({
  ...project,
  state: parseProjectState(status, project.job),
});

// Неизвестный статус — скорее всего новый этап обработки, поэтому опрос не прекращается.
export const isProcessing = (state: ProjectState): boolean =>
  state.kind === 'processing' || state.kind === 'unknown';

// started_at бэкенд ставит при старте воркера, так что время в очереди сюда не входит.
export function getProcessingDurationMs(job: Job): number | null {
  if (job.started_at == null || job.finished_at == null) return null;
  return Date.parse(job.finished_at) - Date.parse(job.started_at);
}

// Бэкенд отвечает 404 и на «проекта нет», и на «результат ещё не готов», а текст detail
// не контракт. Различаем по статусу проекта, который уже есть у вызывающего кода.
export function toResultError(
  error: FetchBaseQueryError | SerializedError | undefined,
  state: ProjectState,
): AppError {
  const appError = toAppError(error);
  // «Дождитесь окончания» уместно, только пока обработка идёт: у draft и failed ждать нечего.
  if (appError.kind === 'http' && appError.status === 404 && isProcessing(state)) {
    return { kind: 'not-ready' };
  }
  return appError;
}

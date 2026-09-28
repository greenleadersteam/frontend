import type { ApiComponents, ProposedApiComponents } from '@/shared/api';

export type ProjectResponse = ApiComponents['schemas']['ProjectResponse'];
export type Job = ApiComponents['schemas']['JobStatus'];
export type JobError = ApiComponents['schemas']['JobError'];
export type UploadErrorCode = ApiComponents['schemas']['UploadErrorCode'];

// Значения статуса есть только в контракте-предложении: в спецификации бэкенда это строка.
type KnownStatus = ProposedApiComponents['schemas']['ProjectStatus'];
export type ProcessingStage = Exclude<KnownStatus, 'draft' | 'ready' | 'failed'>;
export type PlantType = ProposedApiComponents['schemas']['PlantType'];

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

// Обработка упала на геопривязке: пунктов мало или каталог geobridge недоступен. Подоснова
// разобрана, и чертёж можно привязать к карте вручную (PUT /georeference) — в контуре без
// интернета так упадёт каждый проект с областью участка.
export const failedOnGeoreference = (state: ProjectState): boolean =>
  state.kind === 'failed' &&
  (state.error?.code === 'insufficient_geodetic_points' ||
    state.error?.code === 'georeference_service_error');

// Архив принимается без архива и после ошибки обработки (../backend/greenplan/api/jobs.py:52).
// После ambiguous_root_dxf вместо нового архива выбирается главный чертёж из уже загруженного.
export function archiveAction(state: ProjectState): 'upload' | 'choose-root' | null {
  if (state.kind === 'draft') return 'upload';
  if (state.kind !== 'failed') return null;
  return state.error?.code === 'ambiguous_root_dxf' ? 'choose-root' : 'upload';
}

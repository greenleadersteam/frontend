import type { AppError } from '@/shared/api';

import type { CheckedArchive } from './check-archive';

export type ProjectDetails = { name: string; description: string };

// Точка прогресса для оценки скорости: момент и сколько байт отправлено к нему.
type ProgressSample = { at: number; sentBytes: number };

export type UploadState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'uploading'; sentBytes: number; totalBytes: number; samples: ProgressSample[] }
  | { kind: 'failed'; error: AppError }
  // 409: статус проекта не позволяет загрузку, а обработки не видно. Новый архив это
  // не исправит — мастер предлагает открыть проект или вернуться к списку.
  | { kind: 'conflict'; projectId: string }
  // acceptedAt — Date.now() ответа 202: данные проекта старше него описывают прошлую обработку.
  | { kind: 'accepted'; acceptedAt: number };

// keepOnLeave: проект нельзя удалять при уходе — он существовал до мастера или архив
// уже принят (ответ 202). Иначе уход до 202 удаляет созданный мастером проект (api.md).
export type WizardProject = { id: string; name: string; keepOnLeave: boolean };

export type WizardState = {
  step: 'details' | 'archive' | 'processing';
  details: ProjectDetails | null;
  archive: CheckedArchive | null;
  project: WizardProject | null;
  upload: UploadState;
  // Сообщение на шаге «Архив» после 413 или ошибки обработки.
  archiveNotice: string | null;
};

export type WizardAction =
  | { type: 'detailsSubmitted'; details: ProjectDetails }
  | { type: 'backToDetails' }
  | { type: 'archiveChecked'; archive: CheckedArchive }
  | { type: 'archiveCleared' }
  | { type: 'uploadRequested' }
  | { type: 'projectCreated'; id: string; name: string }
  | { type: 'uploadProgressed'; sentBytes: number; totalBytes: number; at: number }
  | { type: 'uploadFailed'; error: AppError }
  | { type: 'uploadConflicted'; projectId: string }
  | { type: 'uploadAccepted'; at: number }
  | { type: 'uploadCancelled'; projectDeleted: boolean }
  | { type: 'returnedToArchive'; notice: string | null };

// Окно скользящей оценки скорости: последние 5 с загрузки.
const SPEED_WINDOW_MS = 5000;

// Как начинается мастер для существующего проекта: с выбора архива или, после
// ambiguous_root_dxf, сразу с выбора главного DXF на шаге обработки.
export type WizardEntry = { project: WizardProject; start: 'archive' | 'root-choice' };

export const initialWizardState = (entry: WizardEntry | null): WizardState => ({
  step: entry === null ? 'details' : entry.start === 'archive' ? 'archive' : 'processing',
  details: null,
  archive: null,
  project: entry?.project ?? null,
  // Архив проекта принят ещё до мастера: любые его данные актуальны (acceptedAt = 0).
  upload: entry?.start === 'root-choice' ? { kind: 'accepted', acceptedAt: 0 } : { kind: 'idle' },
  archiveNotice: null,
});

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'detailsSubmitted':
      return { ...state, step: 'archive', details: action.details };
    case 'backToDetails':
      return { ...state, step: 'details' };
    case 'archiveChecked':
      return { ...state, archive: action.archive, archiveNotice: null };
    case 'archiveCleared':
      return { ...state, archive: null };
    case 'uploadRequested':
      return { ...state, step: 'processing', upload: { kind: 'creating' }, archiveNotice: null };
    case 'projectCreated':
      return { ...state, project: { id: action.id, name: action.name, keepOnLeave: false } };
    case 'uploadProgressed': {
      const previous = state.upload.kind === 'uploading' ? state.upload.samples : [];
      const samples = [...previous, { at: action.at, sentBytes: action.sentBytes }].filter(
        ({ at }) => action.at - at <= SPEED_WINDOW_MS,
      );
      return {
        ...state,
        upload: {
          kind: 'uploading',
          sentBytes: action.sentBytes,
          totalBytes: action.totalBytes,
          samples,
        },
      };
    }
    case 'uploadFailed':
      return { ...state, upload: { kind: 'failed', error: action.error } };
    case 'uploadConflicted':
      // Проект уже не черновик мастера: при уходе он не удаляется.
      return {
        ...state,
        upload: { kind: 'conflict', projectId: action.projectId },
        project: state.project && { ...state.project, keepOnLeave: true },
      };
    case 'uploadAccepted':
      return {
        ...state,
        upload: { kind: 'accepted', acceptedAt: action.at },
        project: state.project && { ...state.project, keepOnLeave: true },
      };
    case 'uploadCancelled':
      return {
        ...state,
        step: 'archive',
        upload: { kind: 'idle' },
        project: action.projectDeleted ? null : state.project,
      };
    case 'returnedToArchive':
      return {
        ...state,
        step: 'archive',
        archive: null,
        upload: { kind: 'idle' },
        archiveNotice: action.notice,
      };
    default: {
      const unexpected: never = action;
      return unexpected;
    }
  }
}

// Сколько секунд осталось, по скорости в скользящем окне. Пока данных мало (меньше трёх
// точек или окно короче 1,5 с), оценки нет: первые секунды скорость скачет.
export function estimateRemainingSeconds(upload: UploadState): number | null {
  if (upload.kind !== 'uploading') return null;
  const first = upload.samples[0];
  const last = upload.samples.at(-1);
  if (first === undefined || last === undefined || upload.samples.length < 3) return null;
  const elapsedMs = last.at - first.at;
  const sent = last.sentBytes - first.sentBytes;
  if (elapsedMs < 1500 || sent <= 0) return null;
  return Math.ceil(((upload.totalBytes - upload.sentBytes) / sent) * (elapsedMs / 1000));
}

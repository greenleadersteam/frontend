import { isProcessing, type Project } from '@/entities/project';

// Порог зависшей обработки: столько же длится предохранитель опроса (api.md).
export const PROCESSING_HANG_MINUTES = 30;

export type ProcessingHang = 'queued' | 'processing';

type DeleteAvailability = { locked: false; hang: ProcessingHang | null } | { locked: true };

type PollingSnapshot = {
  // Предохранитель опроса сработал.
  stalled: boolean;
  // Когда получен последний ответ (Date.now()): от него считается длительность обработки.
  checkedAt: number;
};

// Бэкенд удаляет проект в любом статусе (../backend/greenplan/api/app.py:87-94), но идущую
// обработку не останавливает. Поэтому удаление во время обработки открывается, только когда
// предохранитель сработал и обработка к последнему ответу шла дольше 30 минут. started_at
// бэкенд ставит при постановке в очередь и перезаписывает при старте воркера
// (../backend/greenplan/api/jobs.py:145, :269). Сравниваются часы сервера и клиента:
// расхождение в минуты на таком пороге не важно.
export function deleteAvailability(
  { state, job }: Project,
  { stalled, checkedAt }: PollingSnapshot,
): DeleteAvailability {
  if (!isProcessing(state)) return { locked: false, hang: null };
  const hangs =
    stalled &&
    job.started_at != null &&
    checkedAt - Date.parse(job.started_at) >= PROCESSING_HANG_MINUTES * 60 * 1000;
  if (!hangs) return { locked: true };
  return {
    locked: false,
    hang: state.kind === 'processing' && state.stage === 'queued' ? 'queued' : 'processing',
  };
}

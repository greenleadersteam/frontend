import { useSyncExternalStore } from 'react';

import {
  type ManualGeoreference,
  type Project,
  usePutGeoreferenceMutation,
} from '@/entities/project';
import { type AppError, toAppError } from '@/shared/api';
import { useCapability } from '@/shared/config';

import {
  parseStored,
  readStoredRaw,
  removeStored,
  type StoredGeoreference,
  subscribeStored,
  writeStored,
} from './stored';

// Привязка проекта в этом браузере. У проекта с геопривязкой сервера её нет: его данные уже
// в WGS84, и запись в браузере осталась бы от времени до привязки на сервере.
export function useBrowserGeoreference(project: Project): StoredGeoreference {
  const raw = useSyncExternalStore(subscribeStored, () => readStoredRaw(project.id));
  if (project.job.georeference != null) return { kind: 'none' };
  return parseStored(raw, project.job.finished_at ?? null);
}

export const removeBrowserGeoreference = removeStored;

export type ApplyOutcome =
  // Сервер принял привязку и обрабатывает проект заново.
  | { kind: 'server' }
  | { kind: 'browser' }
  // error null — браузер не дал сохранить привязку.
  | { kind: 'failed'; error: AppError | null };

// Применить привязку к проекту: с возможностью manualGeoreference — PUT /georeference, иначе —
// в браузер, до следующей обработки проекта.
export function useApplyGeoreference(): {
  apply: (project: Project, georeference: ManualGeoreference) => Promise<ApplyOutcome>;
  applying: boolean;
} {
  const onServer = useCapability('manualGeoreference');
  const [put, { isLoading }] = usePutGeoreferenceMutation();
  return {
    applying: isLoading,
    apply: async (project, georeference) => {
      if (!onServer) {
        return writeStored(project.id, project.job.finished_at ?? null, georeference)
          ? { kind: 'browser' }
          : { kind: 'failed', error: null };
      }
      const result = await put({ id: project.id, georeference });
      if ('error' in result) return { kind: 'failed', error: toAppError(result.error) };
      // Привязка теперь на сервере: запись в браузере от прошлых попыток не нужна.
      removeStored(project.id);
      return { kind: 'server' };
    },
  };
}

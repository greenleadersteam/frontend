import type { SerializedError } from '@reduxjs/toolkit';
import { type FetchBaseQueryError, skipToken } from '@reduxjs/toolkit/query';
import { useEffect } from 'react';

import {
  type PlantingFeatureCollection,
  type PlantingVersion,
  type Project,
  useEditPlantingVersionMutation,
  useGetPlantingVersionQuery,
  useGetPlantingVersionsQuery,
  useLazyGetPlantingVersionQuery,
} from '@/entities/project';
import { type AppError, toAppError } from '@/shared/api';
import { useCapability } from '@/shared/config';
import { useAppDispatch, useAppSelector } from '@/shared/lib/store';

import { readDraft, removeDraft, writeDraft } from './draft';
import {
  countEdits,
  type EditCounts,
  type EditsStorage,
  emptyDiff,
  type FinalPlanting,
  isUnsaved,
  type PlantingDiff,
  plantingEditsActions as actions,
  selectFinalPlanting,
  selectProjectEdits,
} from './edits';
import { diffFromVersion, isEmptyEdit, versionEdit } from './version-edit';

export type PlantingVersions = {
  // null — возможности plantingEdits нет или список ещё не пришёл.
  list: PlantingVersion[] | null;
  // Версия, которую показывает экран: выбранная или последняя.
  target: number | null;
  error: FetchBaseQueryError | SerializedError | undefined;
  fetching: boolean;
  retry: () => void;
};

// Версии плана посадок (plantingEdits): список и версия, которую показать.
export function usePlantingVersions(projectId: string): PlantingVersions {
  const withServer = useCapability('plantingEdits');
  const list = useGetPlantingVersionsQuery(projectId, { skip: !withServer });
  const selected = useAppSelector((state) => selectProjectEdits(state, projectId)?.selected);
  // Выбранной версии может не быть в списке: новая обработка начала историю заново.
  const target = list.data?.find(({ id }) => id === selected)?.id ?? list.data?.at(-1)?.id ?? null;
  const version = useGetPlantingVersionQuery(
    withServer && target !== null ? { id: projectId, version: target } : skipToken,
  );
  return {
    list: list.data ?? null,
    target,
    error: list.error ?? version.error,
    fetching: list.isFetching || version.isFetching,
    retry: () => {
      if (list.isError) void list.refetch();
      if (version.isError) void version.refetch();
    },
  };
}

// Загрузка правок при открытии проекта и черновик в браузере. Вызывается там, откуда проект
// открывают: на экране результата и в отчёте. Запись правок в store одна: второй вызов её
// не перезагружает, остальные компоненты правки только читают.
export function useEditsLoader(project: Project, source: PlantingFeatureCollection): void {
  const dispatch = useAppDispatch();
  const withServer = useCapability('plantingEdits');
  const { target } = usePlantingVersions(project.id);
  // currentData — версия именно target: data при смене версии ещё держит прежнюю.
  const version = useGetPlantingVersionQuery(
    withServer && target !== null ? { id: project.id, version: target } : skipToken,
  ).currentData;
  const entry = useAppSelector((state) => selectProjectEdits(state, project.id));
  const finishedAt = project.job.finished_at ?? null;

  // Правки — внешнее состояние (сервер или хранилище браузера): загружаются один раз на версию.
  useEffect(() => {
    if (withServer) {
      // Без ответа сервера правки не открываются: ошибку и повтор показывает EditsLoadAlert.
      const current = entry?.version === target && entry.finishedAt === finishedAt;
      if (target === null || version === undefined || current) return;
      dispatch(
        actions.opened({
          projectId: project.id,
          diff: diffFromVersion(source, version),
          storage: 'server',
          version: target,
          finishedAt,
        }),
      );
      return;
    }
    if (entry !== undefined) return;
    const draft = readDraft(project.id, finishedAt);
    switch (draft.kind) {
      case 'current':
        dispatch(actions.opened({ projectId: project.id, diff: draft.diff, storage: 'draft' }));
        return;
      case 'stale':
        dispatch(actions.staleFound({ projectId: project.id, diff: draft.diff }));
        return;
      case 'none':
        dispatch(actions.opened({ projectId: project.id, diff: emptyDiff(), storage: 'draft' }));
        return;
      case 'unavailable':
        dispatch(actions.opened({ projectId: project.id, diff: emptyDiff(), storage: 'memory' }));
        return;
      default: {
        const unexpected: never = draft;
        return unexpected;
      }
    }
  }, [dispatch, entry, withServer, target, version, source, project.id, finishedAt]);

  // Черновик в браузере — копия каждой правки: без кнопки «Сохранить».
  const present = entry?.present;
  const saved = entry?.saved;
  const draftable = entry?.storage === 'draft' && !entry.readOnly && entry.stale === null;
  useEffect(() => {
    if (!draftable || present === undefined || present === saved) return;
    if (writeDraft(project.id, finishedAt, present)) {
      dispatch(actions.saved({ projectId: project.id, diff: present }));
    } else {
      dispatch(actions.storageLost({ projectId: project.id }));
    }
  }, [dispatch, draftable, present, saved, project.id, finishedAt]);
}

export type PlantingEditsView = {
  final: FinalPlanting;
  diff: PlantingDiff;
  counts: EditCounts;
  loaded: boolean;
  editing: boolean;
  readOnly: boolean;
  storage: EditsStorage;
  stale: boolean;
  canUndo: boolean;
  canRedo: boolean;
  // Есть правки, которых нет в версии на сервере (при plantingEdits).
  unsaved: boolean;
  // Версия с сервера ещё не на экране: сохранять не от чего.
  switching: boolean;
  // Версия плана посадок на экране; null — правки не на сервере.
  version: number | null;
};

export function usePlantingEdits(
  projectId: string,
  source: PlantingFeatureCollection,
): PlantingEditsView {
  const entry = useAppSelector((state) => selectProjectEdits(state, projectId));
  const final = useAppSelector((state) => selectFinalPlanting(state, projectId, source));
  const diff = entry?.present ?? emptyDiff();
  return {
    final,
    diff,
    counts: countEdits(diff),
    loaded: entry !== undefined,
    editing: entry?.editing ?? false,
    readOnly: entry?.readOnly ?? false,
    storage: entry?.storage ?? 'server',
    stale: entry?.stale != null,
    canUndo: (entry?.past.length ?? 0) > 0,
    canRedo: (entry?.future.length ?? 0) > 0,
    unsaved: entry !== undefined && isUnsaved(entry),
    switching:
      entry?.storage === 'server' && (entry.version === null || entry.selected !== entry.version),
    version: entry?.version ?? null,
  };
}

// Решение по черновику прошлой обработки.
export function useStaleDraft(projectId: string): { discard: () => void; keep: () => void } {
  const dispatch = useAppDispatch();
  const entry = useAppSelector((state) => selectProjectEdits(state, projectId));
  return {
    discard: () => {
      removeDraft(projectId);
      dispatch(actions.opened({ projectId, diff: emptyDiff(), storage: 'draft' }));
    },
    keep: () => {
      if (entry?.stale == null) return;
      dispatch(actions.opened({ projectId, diff: entry.stale, readOnly: true, storage: 'draft' }));
    },
  };
}

// «Сохранить» (plantingEdits): правка версии на экране создаёт новую версию. Она сразу
// загружается и становится текущей, а несохранённых правок больше нет.
export function useSavePlantings(
  projectId: string,
  source: PlantingFeatureCollection,
): {
  save: (name: string) => Promise<AppError | null>;
  saving: boolean;
} {
  const dispatch = useAppDispatch();
  const entry = useAppSelector((state) => selectProjectEdits(state, projectId));
  const [editVersion, { isLoading }] = useEditPlantingVersionMutation();
  const [loadVersion, { isFetching }] = useLazyGetPlantingVersionQuery();
  const finishedAt = useAppSelector(
    (state) => selectProjectEdits(state, projectId)?.finishedAt ?? null,
  );
  const save = async (name: string): Promise<AppError | null> => {
    // Кнопка недоступна, пока версия не на экране (switching).
    if (entry?.version == null) return { kind: 'unknown' };
    const edit = versionEdit(source, entry.saved, entry.present, name);
    // Посадку вернули туда же, где она в версии: менять нечего, и сервер такую правку не примет.
    if (isEmptyEdit(edit)) {
      dispatch(actions.saved({ projectId, diff: entry.present }));
      return null;
    }
    const created = await editVersion({ id: projectId, version: entry.version, edit });
    if ('error' in created) return toAppError(created.error);
    const loaded = await loadVersion({ id: projectId, version: created.data.id });
    if (loaded.data === undefined) {
      // Версия создана, но не пришла: её загрузит загрузчик правок, а сбой и «Повторить»
      // покажет EditsLoadAlert. Сохранить ещё раз до загрузки нельзя (switching).
      dispatch(actions.versionSelected({ projectId, version: created.data.id }));
      return null;
    }
    dispatch(
      actions.opened({
        projectId,
        diff: diffFromVersion(source, loaded.data),
        storage: 'server',
        version: created.data.id,
        finishedAt,
      }),
    );
    return null;
  };
  return { save, saving: isLoading || isFetching };
}

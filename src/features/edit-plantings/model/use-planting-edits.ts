import { useEffect } from 'react';

import {
  type CheckedPlantingsFeatureCollection,
  type PlantingFeatureCollection,
  type PlantingStatus,
  type Project,
  useGetPlantingsQuery,
  usePutPlantingsMutation,
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
  type Point,
  selectFinalPlanting,
  selectProjectEdits,
} from './edits';

const samePoint = (a: readonly number[], b: readonly number[]) => a[0] === b[0] && a[1] === b[1];

// Разница сохранённого сервером списка с расстановкой сервиса: из неё строятся правки.
export function diffFromServer(
  source: PlantingFeatureCollection,
  saved: CheckedPlantingsFeatureCollection,
): PlantingDiff {
  const diff = emptyDiff();
  const byId = new Map(saved.features.map((feature) => [feature.properties.id, feature]));
  for (const { geometry, properties } of source.features) {
    const edited = byId.get(properties.id);
    if (edited === undefined) {
      diff.removed[properties.id] = true;
      continue;
    }
    const [x = 0, y = 0] = edited.geometry.coordinates;
    if (!samePoint(edited.geometry.coordinates, geometry.coordinates))
      diff.moved[properties.id] = [x, y];
    if (edited.properties.species_id !== (properties.species_id ?? null)) {
      diff.species[properties.id] = edited.properties.species_id;
    }
    byId.delete(properties.id);
  }
  for (const [id, { geometry, properties }] of byId) {
    const [x = 0, y = 0] = geometry.coordinates;
    diff.added[id] = {
      point: [x, y] satisfies Point,
      plantType: properties.plant_type,
      speciesId: properties.species_id,
    };
  }
  return diff;
}

// Загрузка правок при открытии проекта и черновик в браузере. Вызывается там, откуда проект
// открывают: на экране результата и в отчёте. Запись правок в store одна: второй вызов её
// не перезагружает, остальные компоненты правки только читают.
export function useEditsLoader(project: Project, source: PlantingFeatureCollection): void {
  const dispatch = useAppDispatch();
  const withServer = useCapability('plantingEdits');
  const server = useGetPlantingsQuery(project.id, { skip: !withServer });
  const entry = useAppSelector((state) => selectProjectEdits(state, project.id));
  const finishedAt = project.job.finished_at ?? null;

  // Правки — внешнее состояние (сервер или хранилище браузера): загружаются один раз.
  useEffect(() => {
    if (entry !== undefined) return;
    if (withServer) {
      // Без ответа сервера правки не открываются: пустая разница, сохранённая поверх, стёрла бы
      // правки на сервере. Ошибку и повтор показывает EditsLoadAlert.
      if (server.isLoading || server.isUninitialized || server.isError) return;
      dispatch(
        actions.opened({
          projectId: project.id,
          diff: server.data == null ? emptyDiff() : diffFromServer(source, server.data),
          storage: 'server',
        }),
      );
      return;
    }
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
  }, [dispatch, entry, withServer, server, source, project.id, finishedAt]);

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
  // Есть правки, которых нет на сервере (при plantingEdits).
  unsaved: boolean;
  // Статусы сервера — пока с последнего сохранения ничего не менялось.
  serverStatuses: ReadonlyMap<string, PlantingStatus> | null;
};

export function usePlantingEdits(
  projectId: string,
  source: PlantingFeatureCollection,
): PlantingEditsView {
  const entry = useAppSelector((state) => selectProjectEdits(state, projectId));
  const final = useAppSelector((state) => selectFinalPlanting(state, projectId, source));
  const withServer = useCapability('plantingEdits');
  const server = useGetPlantingsQuery(projectId, { skip: !withServer });
  const diff = entry?.present ?? emptyDiff();
  const unsaved = entry !== undefined && isUnsaved(entry);
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
    unsaved,
    serverStatuses:
      unsaved || server.data == null
        ? null
        : new Map(server.data.features.map(({ properties }) => [properties.id, properties.status])),
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

// «Сохранить» (plantingEdits): полный список после правок, статусы сервера — в ответе.
export function useSavePlantings(
  projectId: string,
  source: PlantingFeatureCollection,
): { save: () => Promise<AppError | null>; saving: boolean } {
  const dispatch = useAppDispatch();
  const entry = useAppSelector((state) => selectProjectEdits(state, projectId));
  const final = useAppSelector((state) => selectFinalPlanting(state, projectId, source));
  const [put, { isLoading }] = usePutPlantingsMutation();
  const save = async (): Promise<AppError | null> => {
    if (entry === undefined) return null;
    const present = entry.present;
    const result = await put({
      id: projectId,
      plantings: {
        type: 'FeatureCollection',
        metadata: { crs: source.metadata.crs },
        features: final.features.map(({ geometry, properties }) => ({
          type: 'Feature',
          geometry,
          properties: {
            id: properties.id,
            plant_type: properties.plant_type,
            species_id: properties.species_id ?? null,
            // Контракт: manual — добавлена или перемещена пользователем. В модели перемещённая
            // остаётся auto, как посадка сервиса со своим id.
            origin:
              properties.origin === 'manual' || properties.moved_from !== null ? 'manual' : 'auto',
          },
        })),
      },
    });
    if ('error' in result) return toAppError(result.error);
    dispatch(actions.saved({ projectId, diff: present }));
    return null;
  };
  return { save, saving: isLoading };
}

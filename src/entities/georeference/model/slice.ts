import { createAction, type UnknownAction } from '@reduxjs/toolkit';

import type { Contour, Reference } from '@/shared/lib/contour';
import type { LatLon } from '@/shared/lib/geodesy';
import { isLocked, type WorkScale } from '@/shared/lib/georeference';

import {
  addGcp,
  addReference,
  applyGcp,
  clearReferences,
  closeProject,
  createSession,
  findSameReference,
  loadContour,
  moveBy,
  type NewGcpPair,
  type OpenedProject,
  openProject,
  redo,
  removeGcp,
  removeReference,
  restoreManual,
  rotateBy,
  type Session,
  setAnchor,
  setReferenceVisible,
  setRotation,
  setScale,
  snapshot,
  undo,
  updateGcp,
  updateSession,
} from './session';

export const GEOREFERENCE_SLICE = 'georeference';

// Действия — завершённые операции: одно на жест, клавишу или правку поля. Шаг истории отмены
// (снимок перед изменением, как в прототипе) — у всех, кроме эталонов и масштаба работ: это не
// привязка, а то, с чем её сравнивают и чем меряют.
export const georeferenceActions = {
  contourLoaded: createAction<{ contour: Contour; anchor: LatLon }>(
    `${GEOREFERENCE_SLICE}/contourLoaded`,
  ),
  // Режим проекта: граница участка проекта вместо файла, положение — прежняя привязка проекта
  // или центр карты.
  projectOpened: createAction<OpenedProject>(`${GEOREFERENCE_SLICE}/projectOpened`),
  projectClosed: createAction(`${GEOREFERENCE_SLICE}/projectClosed`),
  contourMoved: createAction<{ anchor: LatLon }>(`${GEOREFERENCE_SLICE}/contourMoved`),
  contourShifted: createAction<{ east: number; north: number }>(
    `${GEOREFERENCE_SLICE}/contourShifted`,
  ),
  contourRotated: createAction<{ rotation: number }>(`${GEOREFERENCE_SLICE}/contourRotated`),
  contourTurned: createAction<{ degrees: number }>(`${GEOREFERENCE_SLICE}/contourTurned`),
  // Масштаб задаёт пользователь — выбором единиц или числом: после этого подсказка про
  // миллиметры не показывается.
  contourScaled: createAction<{ scale: number }>(`${GEOREFERENCE_SLICE}/contourScaled`),
  referenceAdded: createAction<{ reference: Reference }>(`${GEOREFERENCE_SLICE}/referenceAdded`),
  referenceVisibilityChanged: createAction<{ id: string; visible: boolean }>(
    `${GEOREFERENCE_SLICE}/referenceVisibilityChanged`,
  ),
  referenceRemoved: createAction<{ id: string }>(`${GEOREFERENCE_SLICE}/referenceRemoved`),
  referencesCleared: createAction(`${GEOREFERENCE_SLICE}/referencesCleared`),
  // Опорные точки: каждая правка набора сразу пересчитывает положение, и отмена откатывает
  // правку вместе с пересчётом.
  gcpAdded: createAction<{ pair: NewGcpPair }>(`${GEOREFERENCE_SLICE}/gcpAdded`),
  gcpChanged: createAction<{ id: string; enabled?: boolean; control?: boolean }>(
    `${GEOREFERENCE_SLICE}/gcpChanged`,
  ),
  gcpRemoved: createAction<{ id: string }>(`${GEOREFERENCE_SLICE}/gcpRemoved`),
  manualRestored: createAction(`${GEOREFERENCE_SLICE}/manualRestored`),
  workScaleChanged: createAction<{ workScale: WorkScale }>(
    `${GEOREFERENCE_SLICE}/workScaleChanged`,
  ),
  undone: createAction(`${GEOREFERENCE_SLICE}/undone`),
  redone: createAction(`${GEOREFERENCE_SLICE}/redone`),
};

const actions = georeferenceActions;

// Сессия — неизменяемое значение из чистых функций session.ts, поэтому редьюсер обходится без
// immer: черновик ничего не дал бы, а контур в десятки тысяч вершин он обходил бы на каждом
// действии.
export function georeferenceReducer(
  state: Session = createSession(),
  action: UnknownAction,
): Session {
  if (actions.contourLoaded.match(action)) {
    return loadContour(state, action.payload.contour, action.payload.anchor);
  }
  if (actions.projectOpened.match(action)) return openProject(state, action.payload);
  if (actions.projectClosed.match(action)) return closeProject(state);
  // С двух учтённых пар положение задают точки: ручные сдвиг, поворот и масштаб спорили бы
  // с решением.
  const locked = isLocked(state.gcp);
  if (actions.contourMoved.match(action)) {
    return locked ? state : setAnchor(snapshot(state), action.payload.anchor);
  }
  if (actions.contourShifted.match(action)) {
    return locked ? state : moveBy(snapshot(state), action.payload.east, action.payload.north);
  }
  if (actions.contourRotated.match(action)) {
    return locked ? state : setRotation(snapshot(state), action.payload.rotation);
  }
  if (actions.contourTurned.match(action)) {
    return locked ? state : rotateBy(snapshot(state), action.payload.degrees);
  }
  if (actions.contourScaled.match(action)) {
    const { scale } = action.payload;
    if (locked || !Number.isFinite(scale) || scale <= 0) return state;
    return updateSession(setScale(snapshot(state), scale), { unitsConfirmed: true });
  }
  if (actions.referenceAdded.match(action)) {
    const { reference } = action.payload;
    return findSameReference(state, reference) === null ? addReference(state, reference) : state;
  }
  if (actions.referenceVisibilityChanged.match(action)) {
    return setReferenceVisible(state, action.payload.id, action.payload.visible);
  }
  if (actions.referenceRemoved.match(action)) return removeReference(state, action.payload.id);
  if (actions.referencesCleared.match(action)) return clearReferences(state);
  if (actions.gcpAdded.match(action)) {
    return state.source === null ? state : applyGcp(addGcp(snapshot(state), action.payload.pair));
  }
  if (actions.gcpChanged.match(action)) {
    const { id, ...patch } = action.payload;
    return applyGcp(updateGcp(snapshot(state), id, patch));
  }
  if (actions.gcpRemoved.match(action)) {
    return applyGcp(removeGcp(snapshot(state), action.payload.id));
  }
  if (actions.manualRestored.match(action)) return restoreManual(state);
  if (actions.workScaleChanged.match(action)) {
    return updateSession(state, { workScale: action.payload.workScale });
  }
  if (actions.undone.match(action)) return undo(state);
  if (actions.redone.match(action)) return redo(state);
  return state;
}

export const selectGeoreference = (state: RootState): Session => state.georeference;

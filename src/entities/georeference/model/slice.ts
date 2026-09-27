import { createAction, type UnknownAction } from '@reduxjs/toolkit';

import type { Contour, Reference } from '@/shared/lib/contour';
import type { LatLon } from '@/shared/lib/geodesy';

import {
  addReference,
  createSession,
  findSameReference,
  loadContour,
  moveBy,
  redo,
  rotateBy,
  type Session,
  setAnchor,
  setRotation,
  setScale,
  snapshot,
  undo,
  updateSession,
} from './session';

export const GEOREFERENCE_SLICE = 'georeference';

// Действия — завершённые операции: одно на жест, клавишу или правку поля, и каждое, кроме
// эталона, — шаг истории отмены (снимок перед изменением, как в прототипе).
export const georeferenceActions = {
  contourLoaded: createAction<{ contour: Contour; anchor: LatLon }>(
    `${GEOREFERENCE_SLICE}/contourLoaded`,
  ),
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
  if (actions.contourMoved.match(action)) return setAnchor(snapshot(state), action.payload.anchor);
  if (actions.contourShifted.match(action)) {
    return moveBy(snapshot(state), action.payload.east, action.payload.north);
  }
  if (actions.contourRotated.match(action)) {
    return setRotation(snapshot(state), action.payload.rotation);
  }
  if (actions.contourTurned.match(action)) {
    return rotateBy(snapshot(state), action.payload.degrees);
  }
  if (actions.contourScaled.match(action)) {
    const { scale } = action.payload;
    if (!Number.isFinite(scale) || scale <= 0) return state;
    return updateSession(setScale(snapshot(state), scale), { unitsConfirmed: true });
  }
  if (actions.referenceAdded.match(action)) {
    const { reference } = action.payload;
    return findSameReference(state, reference) === null ? addReference(state, reference) : state;
  }
  if (actions.undone.match(action)) return undo(state);
  if (actions.redone.match(action)) return redo(state);
  return state;
}

export const selectGeoreference = (state: RootState): Session => state.georeference;

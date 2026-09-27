import { describe, expect, test } from 'vitest';

import { buildReference } from '@/shared/lib/contour';
import { vincentyInverse } from '@/shared/lib/geodesy';
import { sampleContour } from '@/shared/lib/test';

import { placementOf } from './session';
import { georeferenceActions as actions, georeferenceReducer } from './slice';

const ANCHOR = { lat: 55.75, lon: 37.62 };
const loaded = () =>
  georeferenceReducer(
    undefined,
    actions.contourLoaded({ contour: sampleContour(), anchor: ANCHOR }),
  );

describe('история', () => {
  test('отмена возвращает и сдвиг, и поворот; повтор — обратно', () => {
    const start = loaded();
    const moved = georeferenceReducer(start, actions.contourShifted({ east: 100, north: 0 }));
    const rotated = georeferenceReducer(moved, actions.contourRotated({ rotation: 30 }));

    const undoRotation = georeferenceReducer(rotated, actions.undone());
    expect(undoRotation.rotation).toBe(0);
    expect(undoRotation.anchor).toEqual(moved.anchor);

    const undoMove = georeferenceReducer(undoRotation, actions.undone());
    expect(undoMove.anchor).toEqual(ANCHOR);

    const redo = georeferenceReducer(
      georeferenceReducer(undoMove, actions.redone()),
      actions.redone(),
    );
    expect(redo.rotation).toBe(30);
    expect(redo.anchor).toEqual(moved.anchor);
  });

  test('каждая операция — один шаг истории', () => {
    let state = loaded();
    const depth = state.undoStack.length;
    state = georeferenceReducer(state, actions.contourMoved({ anchor: { lat: 55.76, lon: 37.6 } }));
    state = georeferenceReducer(state, actions.contourTurned({ degrees: 5 }));
    state = georeferenceReducer(state, actions.contourScaled({ scale: 0.001 }));
    expect(state.undoStack.length - depth).toBe(3);
  });
});

describe('операции', () => {
  test('сдвиг клавишей — метры на местности к востоку', () => {
    const shifted = georeferenceReducer(loaded(), actions.contourShifted({ east: 10, north: 0 }));
    const { distance, azimuth } = vincentyInverse(ANCHOR, shifted.anchor ?? ANCHOR);
    expect(distance).toBeCloseTo(10, 6);
    expect(azimuth).toBeCloseTo(90, 3);
  });

  test('поворот на шаг складывается и приводится к (−180°, 180°]', () => {
    const turned = georeferenceReducer(
      georeferenceReducer(loaded(), actions.contourRotated({ rotation: 178 })),
      actions.contourTurned({ degrees: 5 }),
    );
    expect(turned.rotation).toBe(-177);
  });

  test('масштаб от пользователя подтверждает единицы; неверный — не меняет ничего', () => {
    const start = loaded();
    const scaled = georeferenceReducer(start, actions.contourScaled({ scale: 0.001 }));
    expect([scaled.scale, scaled.unitsConfirmed]).toEqual([0.001, true]);
    expect(georeferenceReducer(start, actions.contourScaled({ scale: 0 }))).toBe(start);
    expect(georeferenceReducer(start, actions.contourScaled({ scale: NaN }))).toBe(start);
  });

  test('эталон, совпадающий с открытым, второй раз не добавляется', () => {
    const placement = placementOf(loaded());
    if (placement === null) throw new Error('контур не загружен');
    const value = {
      type: 'Feature',
      properties: {
        поворот_градусы: 0,
        масштаб_метров_в_единице_файла: 1,
        опорная_точка: [ANCHOR.lon, ANCHOR.lat],
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [37.62, 55.75],
            [37.621, 55.75],
            [37.621, 55.751],
            [37.62, 55.75],
          ],
        ],
      },
    };
    const built = buildReference(value, 'эталон.geojson');
    if (!built.ok) throw new Error(built.error.kind);
    const once = georeferenceReducer(
      loaded(),
      actions.referenceAdded({ reference: built.reference }),
    );
    const twice = georeferenceReducer(once, actions.referenceAdded({ reference: built.reference }));
    expect(twice.references).toHaveLength(1);
    expect(twice.undoStack).toBe(once.undoStack);
  });
});

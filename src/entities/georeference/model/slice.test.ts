import { describe, expect, test } from 'vitest';

import { buildReference } from '@/shared/lib/contour';
import { enuFrame, vincentyInverse } from '@/shared/lib/geodesy';
import { isOutlier, stats, vertexLatLon } from '@/shared/lib/georeference';
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

describe('опорные точки', () => {
  // Истинное положение: контур сдвинут на 60 м к северо-востоку и повёрнут на 12°.
  const truth = {
    source: sampleContour(),
    anchor: { lat: 55.7506, lon: 37.621 },
    rotation: 12,
    scale: 1,
  };
  // Пара «вершина контура ↔ её место на местности», с ошибкой в метрах к востоку.
  const pair = (index: number, errE = 0) => {
    const vertex = sampleContour().vertices[index];
    if (vertex === undefined) throw new Error(`нет вершины ${String(index)}`);
    const at = vertexLatLon(vertex, truth);
    const { lat, lon } = enuFrame(at).toGeodetic({ e: errE, n: 0, u: 0 });
    return { x: vertex.x, y: vertex.y, lat, lon };
  };
  const withPairs = (errors: readonly number[]) => {
    let state = loaded();
    const snapshots = [state];
    errors.forEach((errE, index) => {
      state = georeferenceReducer(
        state,
        actions.gcpAdded({ pair: pair([0, 3, 5, 7, 1][index] ?? 0, errE) }),
      );
      snapshots.push(state);
    });
    return snapshots;
  };

  test('положение пересчитывается после каждой пары, начиная со второй', () => {
    const [start, one, two, three] = withPairs([0, 0, 0.3]);
    expect(one?.anchor).toEqual(start?.anchor);
    expect(two?.anchor).not.toEqual(one?.anchor);
    expect(two?.rotation).toBeCloseTo(12, 6);
    expect(three?.anchor).not.toEqual(two?.anchor);
    expect(vincentyInverse(truth.anchor, two?.anchor ?? ANCHOR).distance).toBeLessThan(1e-3);
  });

  test('с двух пар ручные сдвиг, поворот и масштаб не меняют положение', () => {
    const locked = withPairs([0, 0]).at(-1) ?? loaded();
    for (const action of [
      actions.contourShifted({ east: 10, north: 0 }),
      actions.contourTurned({ degrees: 5 }),
      actions.contourScaled({ scale: 0.001 }),
      actions.contourMoved({ anchor: ANCHOR }),
    ]) {
      expect(georeferenceReducer(locked, action)).toBe(locked);
    }
  });

  test('отмена откатывает применение решения целиком: ручное положение, одна пара', () => {
    const snapshots = withPairs([0, 0]);
    const undone = georeferenceReducer(snapshots.at(-1), actions.undone());
    expect(undone.anchor).toEqual(ANCHOR);
    expect(undone.rotation).toBe(0);
    expect(undone.gcp).toHaveLength(1);
    expect(undone.handoff).toBeNull();
  });

  test('«Вернуть ручное» — прежнее положение, точки выключены, но на месте; и отменяется', () => {
    const solved = withPairs([0, 0, 0]).at(-1) ?? loaded();
    const manual = georeferenceReducer(solved, actions.manualRestored());
    expect(manual.anchor).toEqual(ANCHOR);
    expect(manual.gcp.map(({ enabled }) => enabled)).toEqual([false, false, false]);
    expect(manual.handoff).toBeNull();
    expect(georeferenceReducer(manual, actions.undone()).anchor).toEqual(solved.anchor);
  });

  test('выключение точки меняет результат; включение возвращает', () => {
    const solved = withPairs([0, 0, 0, 5]).at(-1) ?? loaded();
    const id = solved.gcp[3]?.id ?? '';
    const off = georeferenceReducer(solved, actions.gcpChanged({ id, enabled: false }));
    expect(off.rotation).not.toBe(solved.rotation);
    expect(off.rotation).toBeCloseTo(12, 6);
    const on = georeferenceReducer(off, actions.gcpChanged({ id, enabled: true }));
    expect(on.rotation).toBe(solved.rotation);
  });

  test('контрольная точка не влияет на параметры, но её невязка считается', () => {
    const solved = withPairs([0, 0, 0, 5]).at(-1) ?? loaded();
    const id = solved.gcp[3]?.id ?? '';
    const control = georeferenceReducer(solved, actions.gcpChanged({ id, control: true }));
    const without = withPairs([0, 0, 0]).at(-1) ?? loaded();
    expect(control.rotation).toBeCloseTo(without.rotation, 12);
    expect(control.anchor).toEqual(without.anchor);
    const placement = placementOf(control);
    if (placement === null) throw new Error('контур не загружен');
    const row = stats(placement, control.gcp, 500).rows.find((r) => r.pair.id === id);
    expect(row?.control).toBe(true);
    expect(row?.dS).toBeCloseTo(5, 3);
  });

  // Ошибка — в вершине 3 (вторая пара): её вес в решении невелик, и ошибка остаётся в невязке,
  // а не растворяется в параметрах (как в проверке прототипа «Виновная точка»).
  test('ошибка 5 м в одной точке из пяти — выброс, RMS за допуском', () => {
    const solved = withPairs([0, 5, 0, 0, 0]).at(-1) ?? loaded();
    const placement = placementOf(solved);
    if (placement === null) throw new Error('контур не загружен');
    const summary = stats(placement, solved.gcp, solved.workScale);
    const flagged = summary.rows.filter((row) => isOutlier(row, summary));
    expect(flagged.map((row) => row.pair.n)).toEqual([2]);
    expect(summary.verdict).toBe('bad');
  });

  test('удаление пары — шаг истории с пересчётом; новый контур сбрасывает точки', () => {
    const solved = withPairs([0, 0, 0]).at(-1) ?? loaded();
    const removed = georeferenceReducer(
      solved,
      actions.gcpRemoved({ id: solved.gcp[2]?.id ?? '' }),
    );
    expect(removed.gcp).toHaveLength(2);
    expect(georeferenceReducer(removed, actions.undone()).gcp).toHaveLength(3);
    const reloaded = georeferenceReducer(
      solved,
      actions.contourLoaded({ contour: sampleContour(), anchor: ANCHOR }),
    );
    expect(reloaded.gcp).toEqual([]);
    expect(reloaded.handoff).toBeNull();
  });
});

describe('эталоны и масштаб работ вне истории', () => {
  test('эталоны (добавление, видимость, удаление) и масштаб работ не добавляют шагов отмены', () => {
    const start = loaded();
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
    const added = georeferenceReducer(
      start,
      actions.referenceAdded({ reference: built.reference }),
    );
    const id = added.references[0]?.id ?? '';
    const steps = [
      added,
      georeferenceReducer(added, actions.referenceVisibilityChanged({ id, visible: false })),
      georeferenceReducer(added, actions.referenceRemoved({ id })),
      georeferenceReducer(added, actions.referencesCleared()),
      georeferenceReducer(start, actions.workScaleChanged({ workScale: 1000 })),
    ];
    for (const step of steps) expect(step.undoStack).toBe(start.undoStack);
    expect(steps[1]?.references[0]?.visible).toBe(false);
    expect(steps[2]?.references).toEqual([]);
  });
});

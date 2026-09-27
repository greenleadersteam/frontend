import { expect, test } from 'vitest';

import { georeferenceActions, georeferenceReducer } from '@/entities/georeference';
import { buildReference } from '@/shared/lib/contour';
import { sampleContour } from '@/shared/lib/test';

import { referenceColor, referencesFeature } from './gcp-geometry';

const SHADES = ['#111111', '#222222', '#333333', '#444444'];

// Выгрузка-эталон с опорной точкой в заданной долготе: разные эталоны — разные положения.
function reference(lon: number) {
  const built = buildReference(
    {
      type: 'Feature',
      properties: {
        поворот_градусы: 0,
        масштаб_метров_в_единице_файла: 1,
        опорная_точка: [lon, 55.75],
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [lon, 55.75],
            [lon + 0.001, 55.75],
            [lon + 0.001, 55.751],
            [lon, 55.75],
          ],
        ],
      },
    },
    `эталон-${String(lon)}.geojson`,
  );
  if (!built.ok) throw new Error(built.error.kind);
  return built.reference;
}

test('у эталона свой оттенок: удаление соседа его не меняет', () => {
  let state = georeferenceReducer(
    undefined,
    georeferenceActions.contourLoaded({
      contour: sampleContour(),
      anchor: { lat: 55.75, lon: 37.6 },
    }),
  );
  for (const lon of [37.61, 37.62, 37.63]) {
    state = georeferenceReducer(
      state,
      georeferenceActions.referenceAdded({ reference: reference(lon) }),
    );
  }
  const colorsOf = (features: ReturnType<typeof referencesFeature>) =>
    Object.fromEntries(
      features.features.map(({ properties }) => [properties.id, properties.color]),
    );
  const before = colorsOf(referencesFeature(state.references, SHADES));
  expect(Object.values(before)).toEqual(['#111111', '#222222', '#333333']);

  const [first] = state.references;
  state = georeferenceReducer(state, georeferenceActions.referenceRemoved({ id: first?.id ?? '' }));
  const after = colorsOf(referencesFeature(state.references, SHADES));
  for (const kept of state.references) {
    expect(after[kept.id]).toBe(before[kept.id]);
    expect(after[kept.id]).toBe(referenceColor(kept, SHADES));
  }
});

test('скрытый эталон не рисуется', () => {
  let state = georeferenceReducer(
    undefined,
    georeferenceActions.referenceAdded({ reference: reference(37.61) }),
  );
  const id = state.references[0]?.id ?? '';
  state = georeferenceReducer(
    state,
    georeferenceActions.referenceVisibilityChanged({ id, visible: false }),
  );
  expect(referencesFeature(state.references, SHADES).features).toEqual([]);
});

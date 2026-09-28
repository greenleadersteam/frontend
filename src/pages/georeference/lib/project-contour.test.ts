import { describe, expect, test } from 'vitest';

import type { PlantingFeatureCollection, ZonesFeatureCollection } from '@/entities/project';

import { convexHull, PLANTINGS_MARGIN_M, projectContour } from './project-contour';

const DRAWING_CRS = 'local drawing coordinates, no geo-reference available';

const square = (x: number, y: number, side: number) => [
  [x, y],
  [x + side, y],
  [x + side, y + side],
  [x, y + side],
  [x, y],
];

type ZoneFeature = ZonesFeatureCollection['features'][number];

const zonesOf = (features: ZoneFeature[], usedSiteBoundary: boolean): ZonesFeatureCollection => ({
  type: 'FeatureCollection',
  metadata: { crs: DRAWING_CRS, used_site_boundary: usedSiteBoundary, uncovered_categories: [] },
  features,
});

const boundary: ZoneFeature = {
  type: 'Feature',
  properties: { zone_type: 'site_boundary' },
  geometry: { type: 'Polygon', coordinates: [square(0, 0, 100)] },
};
// Газон из двух частей, у первой — дыра: внешний контур объединения — два кольца без дыры.
const lawn: ZoneFeature = {
  type: 'Feature',
  properties: { zone_type: 'lawn_raw' },
  geometry: {
    type: 'MultiPolygon',
    coordinates: [[square(10, 10, 30), square(20, 20, 5)], [square(60, 10, 20)]],
  },
};

const planting = (points: [number, number][]): PlantingFeatureCollection => ({
  type: 'FeatureCollection',
  metadata: { crs: DRAWING_CRS },
  features: points.map(([x, y], index) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [x, y] },
    properties: {
      id: `T-${String(index)}`,
      plant_type: 'tree',
      rule_id: 'TREE_ROW_CURB',
    },
  })),
});

const TREES = planting([
  [0, 0],
  [40, 0],
  [40, 20],
  [10, 5],
]);

describe('контур проекта', () => {
  test('граница участка, если сервис её использовал', () => {
    const chosen = projectContour(zonesOf([boundary, lawn], true), TREES, 'Проект');

    expect(chosen?.origin).toBe('boundary');
    expect(chosen?.contour.name).toBe('Проект');
    expect(chosen?.contour.bbox).toMatchObject({ minX: 0, minY: 0, width: 100, height: 100 });
  });

  test('граница не использована — внешний контур газона, без дыр', () => {
    const chosen = projectContour(zonesOf([boundary, lawn], false), TREES, 'Проект');

    expect(chosen?.origin).toBe('lawn');
    expect(chosen?.contour.counts).toEqual({ polygons: 2, rings: 2, vertices: 8 });
    expect(chosen?.contour.bbox).toMatchObject({ minX: 10, minY: 10, maxX: 80, maxY: 40 });
  });

  test('ни границы, ни газона — охват посадок с запасом 5 м', () => {
    const chosen = projectContour(zonesOf([], false), TREES, 'Проект');

    expect(chosen?.origin).toBe('plantings');
    expect(chosen?.contour.bbox.minX).toBeCloseTo(-PLANTINGS_MARGIN_M, 9);
    expect(chosen?.contour.bbox.maxX).toBeCloseTo(40 + PLANTINGS_MARGIN_M, 9);
    expect(chosen?.contour.bbox.maxY).toBeCloseTo(20 + PLANTINGS_MARGIN_M, 9);
    // Внутренняя посадка (10; 5) в оболочку не попадает: вершины — только вокруг крайних.
    expect(chosen?.contour.vertices.every(({ x, y }) => Math.hypot(x - 10, y - 5) > 4.9)).toBe(
      true,
    );
  });

  test('ни границы, ни газона, ни посадок — строить не из чего', () => {
    expect(projectContour(zonesOf([], false), planting([]), 'Проект')).toBeNull();
  });
});

test('выпуклая оболочка отбрасывает внутренние точки и точки на рёбрах', () => {
  expect(
    convexHull([
      [0, 0],
      [2, 0],
      [1, 0],
      [2, 2],
      [0, 2],
      [1, 1],
    ]),
  ).toEqual([
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
  ]);
});

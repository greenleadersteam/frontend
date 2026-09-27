import { describe, expect, test } from 'vitest';

import type { ZonesFeatureCollection } from '../api/project-result-api';
import { createLocalFrame } from './local-frame';
import { toMapData } from './map-data';
import type { ResultData } from './result-layers';

const ring = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 0],
];

const data = (crs: string): ResultData => ({
  planting: {
    type: 'FeatureCollection',
    metadata: { crs },
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [10, 10] },
        properties: { id: 'TREE-1', plant_type: 'tree', rule_id: 'TREE_FILL_LAWN' },
      },
    ],
  },
  zones: {
    type: 'FeatureCollection',
    metadata: { crs, used_site_boundary: true, uncovered_categories: [] },
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { zone_type: 'base_area' },
      },
      {
        type: 'Feature',
        geometry: {
          type: 'MultiPolygon',
          coordinates: [[ring], [ring.map(([x = 0, y = 0]) => [x + 20, y])]],
        },
        properties: { zone_type: 'allowed', plant_type: 'tree' },
      },
    ],
  } satisfies ZonesFeatureCollection,
});

const EXTENT = { minX: 0, minY: 0, maxX: 30, maxY: 10 };

describe('toMapData', () => {
  test('данные с геопривязкой не меняются', () => {
    const geographic = data('EPSG:4326 (WGS84 lon/lat)');

    expect(toMapData(geographic, createLocalFrame(EXTENT, true))).toEqual(geographic);
  });

  test('координаты чертежа переводятся во все виды геометрии', () => {
    const frame = createLocalFrame(EXTENT, false);
    const move = (position: number[]) => frame.toMap(frame.toLocal(position));
    const source = data('local drawing coordinates, no geo-reference available');

    const { planting, zones } = toMapData(source, frame);

    expect(planting.features[0]?.geometry.coordinates).toEqual(move([10, 10]));
    expect(zones.features[0]?.geometry).toEqual({ type: 'Polygon', coordinates: [ring.map(move)] });
    expect(zones.features[1]?.geometry).toEqual({
      type: 'MultiPolygon',
      coordinates: [[ring.map(move)], [ring.map(([x = 0, y = 0]) => move([x + 20, y]))]],
    });
    // Условные lon/lat у точки (0, 0): центр охвата чертежа — в начале координат карты.
    expect(move([15, 5])).toEqual([0, 0]);
  });
});

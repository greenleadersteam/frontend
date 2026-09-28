import { expect, test } from 'vitest';

import type { PlantingFeatureCollection, ZonesFeatureCollection } from '@/entities/project';
import { vertexLatLon } from '@/shared/lib/georeference';

import { overlayFeatures, prepareOverlay, simplifyLine } from './project-overlay';

test('упрощение оставляет углы и снимает точки, лежащие на прямой в пределах допуска', () => {
  // Сторона квадрата 10 м с точками через метр и одна точка, выбитая на 5 см.
  const side = Array.from({ length: 11 }, (_, x) => ({ x, y: x === 5 ? 0.05 : 0 }));
  const up = Array.from({ length: 10 }, (_, y) => ({ x: 10, y: y + 1 }));

  expect(simplifyLine([...side, ...up], 0.1)).toEqual([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ]);
  // Отклонение больше допуска — точка остаётся.
  expect(simplifyLine(side, 0.01)).toContainEqual({ x: 5, y: 0.05 });
});

test('план под контуром — только зоны запрета и посадки, тем же путём на карту, что контур', () => {
  const ring = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ];
  const zones: ZonesFeatureCollection = {
    type: 'FeatureCollection',
    metadata: { crs: 'local', used_site_boundary: false, uncovered_categories: [] },
    features: [
      {
        type: 'Feature',
        properties: { zone_type: 'lawn_raw' },
        geometry: { type: 'Polygon', coordinates: [ring] },
      },
      {
        type: 'Feature',
        properties: {
          zone_type: 'prohibited',
          plant_type: 'tree',
          obstacle_category: 'utilities',
          obstacle_subtype: 'gas',
          distance_m: 2,
          citation: '743-ПП — газопровод',
          reason: 'газопровод',
        },
        geometry: { type: 'Polygon', coordinates: [ring] },
      },
    ],
  };
  const planting: PlantingFeatureCollection = {
    type: 'FeatureCollection',
    metadata: { crs: 'local' },
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [3, 4] },
        properties: { id: 'T-1', plant_type: 'shrub', rule_id: 'R' },
      },
    ],
  };
  const placement = {
    source: { center: { x: 5, y: 5 } },
    anchor: { lat: 55.75, lon: 37.62 },
    rotation: 30,
    scale: 1,
  };

  const features = overlayFeatures(prepareOverlay(zones, planting), placement);

  expect(features.zones.features[0]?.geometry.coordinates).toHaveLength(1);
  const { lat, lon } = vertexLatLon({ x: 3, y: 4 }, placement);
  expect(features.plantings.features[0]).toMatchObject({
    properties: { plant_type: 'shrub' },
    geometry: { coordinates: [lon, lat] },
  });
});

import { describe, expect, test } from 'vitest';

import type { ObstaclesFeatureCollection, ZonesFeatureCollection } from '../api/project-result-api';
import { createLocalFrame } from './local-frame';
import { prepareObstacles } from './obstacle-checks';
import { prepareZones } from './planting-checks';
import { overlappingCrowns, plantingStatus } from './planting-status';

const frame = createLocalFrame({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, false);

const rect = (x1: number, y1: number, x2: number, y2: number) => ({
  type: 'Polygon' as const,
  coordinates: [
    [
      [x1, y1],
      [x2, y1],
      [x2, y2],
      [x1, y2],
      [x1, y1],
    ],
  ],
});

// Газон 0..60 × 0..20, в границах участка — до x = 50; зона запрета газопровода — полоса
// y 10,5..13,5 (газ на y = 12, норма 1,5 м).
const zones: ZonesFeatureCollection = {
  type: 'FeatureCollection',
  metadata: { crs: 'local', used_site_boundary: true, uncovered_categories: [] },
  features: [
    { type: 'Feature', geometry: rect(0, 0, 60, 20), properties: { zone_type: 'lawn_raw' } },
    { type: 'Feature', geometry: rect(0, 0, 50, 20), properties: { zone_type: 'base_area' } },
    {
      type: 'Feature',
      geometry: rect(0, 10.5, 50, 13.5),
      properties: {
        zone_type: 'prohibited',
        plant_type: 'tree',
        obstacle_category: 'underground_utilities',
        obstacle_subtype: 'gas',
        distance_m: 1.5,
        citation: '743-ПП — газопровод',
        reason: '< 1.5 м',
      },
    },
  ],
};
const prepared = prepareZones(zones, frame);

const gas: ObstaclesFeatureCollection = {
  type: 'FeatureCollection',
  metadata: { crs: 'local' },
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 12],
          [60, 12],
        ],
      },
      properties: {
        rule_id: '3',
        category: 'underground_utilities',
        subtype: 'gas',
        status: 'auto',
        layer: 'Газ',
        dxftype: 'LINE',
        handle: '1',
      },
    },
  ],
};
const obstacles = prepareObstacles(gas, null, zones, frame);

describe('статус посадки после правки', () => {
  test.each([
    ['в зоне запрета по зонам', [20, 12], null, 'forbidden'],
    ['на газоне вне зон', [20, 5], null, 'allowed'],
    ['вне границы участка, нормы соблюдены', [55, 5], null, 'rejected'],
    ['ближе нормы до газопровода по объектам', [20, 11], obstacles, 'forbidden'],
    ['в пределах допуска 2 см от нормы', [20, 10.51], obstacles, 'allowed'],
    ['за нормой по объектам', [20, 5], obstacles, 'allowed'],
  ] as const)('%s — %s', (_, point, withObstacles, status) => {
    expect(plantingStatus(point, 'tree', prepared, withObstacles)).toBe(status);
  });
});

test('кроны пересекаются, когда стволы ближе суммы радиусов крон', () => {
  const target = { id: 'a', point: [0, 0] as const, plantType: 'tree' as const };

  expect(
    overlappingCrowns(target, [
      target,
      { id: 'b', point: [2.9, 0], plantType: 'tree' },
      { id: 'c', point: [1.8, 0.1], plantType: 'shrub' },
      { id: 'd', point: [3.1, 0], plantType: 'tree' },
    ]),
  ).toBe(2);
});

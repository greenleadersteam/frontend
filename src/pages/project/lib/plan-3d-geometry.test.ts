import { describe, expect, test } from 'vitest';

import type { Species } from '@/entities/project';

import { circle, plantingScene, type ScenePlanting } from './plan-3d-geometry';

const MOSCOW: [number, number] = [37.62, 55.75];
const METERS_PER_DEGREE_LAT = 110_540;

const planting = (...items: { type: 'tree' | 'shrub'; species?: string }[]): ScenePlanting => ({
  features: items.map(({ type, species }) => ({
    geometry: { coordinates: MOSCOW },
    properties: { plant_type: type, species_id: species ?? null },
  })),
});

// Радиус многоугольника в метрах по широте — от центра до вершины на северной стороне.
const northRadius = (polygon: GeoJSON.Polygon) =>
  (Math.max(...(polygon.coordinates[0] ?? []).map(([, lat = 0]) => lat)) - MOSCOW[1]) *
  METERS_PER_DEGREE_LAT;

describe('геометрия 3D-сцены', () => {
  test('круг — 8 вершин и замыкающая, радиус в метрах с поправкой долготы на широту', () => {
    const ring = circle(MOSCOW, 5).coordinates[0] ?? [];

    expect(ring).toHaveLength(9);
    expect(ring[8]).toEqual(ring[0]);
    const [east = 0] = ring[0] ?? [];
    // Восточная вершина: 2,5 м по долготе на широте Москвы.
    expect((east - MOSCOW[0]) * 111_320 * Math.cos((MOSCOW[1] * Math.PI) / 180)).toBeCloseTo(2.5);
  });

  test('дерево без породы — ствол ∅ 0,4 м до 2,5 м и крона ∅ 5 м от 2,5 до 8 м', () => {
    const { extrusions, conventional } = plantingScene(planting({ type: 'tree' }), new Map());
    const [trunk, crown] = extrusions.features;

    expect(trunk?.properties).toEqual({ part: 'trunk', base: 0, top: 2.5 });
    expect(crown?.properties).toEqual({ part: 'crown', base: 2.5, top: 8 });
    expect(northRadius(trunk?.geometry ?? circle(MOSCOW, 0))).toBeCloseTo(0.2, 2);
    expect(northRadius(crown?.geometry ?? circle(MOSCOW, 0))).toBeCloseTo(2.5, 2);
    expect(conventional).toBe(true);
  });

  test('кустарник — цилиндр ∅ 1,2 м высотой 1,2 м', () => {
    const [shrub] = plantingScene(planting({ type: 'shrub' }), new Map()).extrusions.features;

    expect(shrub?.properties).toEqual({ part: 'shrub', base: 0, top: 1.2 });
    expect(northRadius(shrub?.geometry ?? circle(MOSCOW, 0))).toBeCloseTo(0.6, 2);
  });

  test('порода со справочными размерами — высота и крона из справочника, не условные', () => {
    const linden: Species = {
      id: 'tilia',
      name_ru: 'Липа',
      name_lat: 'Tilia',
      plant_type: 'tree',
      crown_diameter_m: 7,
      height_m: 16,
      root_system: null,
      source: 'справочник',
    };
    const scene = plantingScene(
      planting({ type: 'tree', species: 'tilia' }),
      new Map([['tilia', linden]]),
    );
    const [trunk, crown] = scene.extrusions.features;

    expect(crown?.properties).toEqual({ part: 'crown', base: 5, top: 16 });
    expect(trunk?.properties.top).toBe(5);
    expect(northRadius(crown?.geometry ?? circle(MOSCOW, 0))).toBeCloseTo(3.5, 2);
    expect(scene.conventional).toBe(false);
  });
});

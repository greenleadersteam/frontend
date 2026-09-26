import type { ExpressionSpecification } from 'maplibre-gl';
import { describe, expect, test } from 'vitest';

import { resultLayerColors } from '@/shared/theme';

import type { PlantingFeatureCollection, ZonesFeatureCollection } from '../api/project-result-api';
import {
  crownRadiusExpression,
  hatchPattern,
  RESULT_LAYER,
  RESULT_SOURCE,
  resultCounts,
  resultExtent,
  resultLayers,
  resultSources,
} from './result-layers';

// Вычислитель ровно тех выражений, что строит crownRadiusExpression.
function evaluate(expression: unknown, zoom: number, properties: Record<string, number>): number {
  if (typeof expression === 'number') return expression;
  if (!Array.isArray(expression)) throw new Error(`не выражение: ${String(expression)}`);
  const [operator, ...args] = expression as [string, ...unknown[]];
  const value = (arg: unknown) => evaluate(arg, zoom, properties);
  switch (operator) {
    case 'get':
      return properties[String(args[0])] ?? Number.NaN;
    case '+':
      return args.map(value).reduce((sum, next) => sum + next, 0);
    case '*':
      return args.map(value).reduce((product, next) => product * next, 1);
    case 'max':
      return Math.max(...args.map(value));
    case 'interpolate': {
      const [, , ...stops] = args;
      const pairs: [number, unknown][] = [];
      for (let index = 0; index < stops.length; index += 2) {
        pairs.push([Number(stops[index]), stops[index + 1]]);
      }
      const upper = pairs.findIndex(([stop]) => stop >= zoom);
      const [z1, v1] = pairs[upper] ?? pairs[pairs.length - 1] ?? [0, 0];
      if (upper <= 0 || z1 === zoom) return value(v1);
      const [z0, v0] = pairs[upper - 1] ?? [0, 0];
      const t = (2 ** (zoom - z0) - 1) / (2 ** (z1 - z0) - 1);
      return value(v0) + (value(v1) - value(v0)) * t;
    }
    default:
      throw new Error(`неизвестный оператор ${operator}`);
  }
}

const LAT = 55.75;
const expected = (radiusM: number, zoom: number) =>
  (radiusM * 512 * 2 ** zoom) / (40_075_016.686 * Math.cos((LAT * Math.PI) / 180));

describe('crownRadiusExpression', () => {
  test('zoom 18, широта 55,75°: крона 5 м — в пределах 1 % от расчётного', () => {
    const radius = evaluate(crownRadiusExpression({ latitude: LAT }), 18, { crown_radius_m: 5 });

    expect(Math.abs(radius / expected(5, 18) - 1)).toBeLessThan(0.01);
  });

  test('между целыми zoom — то же удвоение', () => {
    const radius = evaluate(crownRadiusExpression({ latitude: LAT }), 18.5, {
      crown_radius_m: 5,
    });

    expect(Math.abs(radius / expected(5, 18.5) - 1)).toBeLessThan(0.01);
  });

  test('на мелком масштабе — не меньше 1,5 пикселя', () => {
    expect(evaluate(crownRadiusExpression({ latitude: LAT }), 9, { crown_radius_m: 0.35 })).toBe(
      1.5,
    );
  });

  test('смещение кольца добавляется к радиусу', () => {
    const expression: ExpressionSpecification = crownRadiusExpression({
      latitude: LAT,
      offsetPx: 3,
    });

    expect(evaluate(expression, 18, { crown_radius_m: 5 })).toBeCloseTo(expected(5, 18) + 3, 1);
  });
});

const planting: PlantingFeatureCollection = {
  type: 'FeatureCollection',
  metadata: { crs: 'EPSG:4326 (WGS84 lon/lat)' },
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [37.6, LAT] },
      properties: { id: 'TREE_ROW_CURB-00001', plant_type: 'tree', rule_id: 'TREE_ROW_CURB' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [37.601, 55.751] },
      properties: { id: 'SHRUB_FILL_LAWN-00001', plant_type: 'shrub', rule_id: 'SHRUB_FILL_LAWN' },
    },
  ],
};

const square = (x: number, y: number) => [
  [
    [x, y],
    [x + 0.001, y],
    [x + 0.001, y + 0.001],
    [x, y],
  ],
];

const zones: ZonesFeatureCollection = {
  type: 'FeatureCollection',
  metadata: {
    crs: 'EPSG:4326 (WGS84 lon/lat)',
    used_site_boundary: true,
    uncovered_categories: [],
  },
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: square(37.599, 55.749) },
      properties: {
        zone_type: 'prohibited',
        plant_type: 'tree',
        obstacle_category: 'gas',
        obstacle_subtype: null,
        distance_m: 1.5,
        citation: '743-ПП — газопровод',
        reason: 'отступ',
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: square(30, 50) },
      properties: { zone_type: 'site_boundary' },
    },
  ],
};

describe('источники и слои результата', () => {
  test('порядок снизу вверх: зоны, штриховка, кустарники, тени, деревья, блики, выбор', () => {
    expect(resultLayers(LAT).map(({ id }) => id)).toEqual([
      RESULT_LAYER.zones,
      RESULT_LAYER.zonesHatch,
      RESULT_LAYER.shrubs,
      RESULT_LAYER.treeShadows,
      RESULT_LAYER.trees,
      RESULT_LAYER.treeHighlights,
      RESULT_LAYER.selectionOuter,
      RESULT_LAYER.selectionInner,
    ]);
  });

  test('посадки — с promoteId по id и радиусом кроны по типу', () => {
    const source = resultSources({ planting, zones }, LAT)[RESULT_SOURCE.planting];

    expect(source.promoteId).toBe('id');
    expect(source.data).toMatchObject({
      features: [
        { properties: { id: 'TREE_ROW_CURB-00001', crown_radius_m: 1.5 } },
        { properties: { id: 'SHRUB_FILL_LAWN-00001', crown_radius_m: 0.35 } },
      ],
    });
  });

  test('блик — только у деревьев, к северо-западу от центра кроны', () => {
    const { data } = resultSources({ planting, zones }, LAT)[RESULT_SOURCE.highlights];
    if (typeof data === 'string' || data.type !== 'FeatureCollection') throw new Error('данные');
    const [highlight] = data.features;
    if (highlight?.geometry.type !== 'Point') throw new Error('ожидалась точка');
    const [lon = 0, lat = 0] = highlight.geometry.coordinates;

    expect(data.features).toHaveLength(1);
    expect(lon).toBeLessThan(37.6);
    expect(lat).toBeGreaterThan(LAT);
    // 0,3 радиуса кроны 1,5 м к северу.
    expect((lat - LAT) * 111_320).toBeCloseTo(0.45, 3);
  });

  test('на карте — только зоны запрета; охват — по ним и по посадкам', () => {
    const { data } = resultSources({ planting, zones }, LAT)[RESULT_SOURCE.zones];

    expect(data).toMatchObject({ features: [{ properties: { zone_type: 'prohibited' } }] });
    expect(resultExtent({ planting, zones })).toEqual({
      minX: 37.599,
      minY: 55.749,
      maxX: 37.601,
      maxY: 55.751,
    });
    expect(resultCounts({ planting, zones })).toEqual({ trees: 1, shrubs: 1, zones: 1 });
  });

  test('выбранная посадка — белое кольцо 3px и тёмное 1,5px по feature-state', () => {
    const rings = resultLayers(LAT).filter(({ id }) => id.startsWith('planting-selection'));

    expect(rings.map((layer) => layer.type === 'circle' && layer.paint)).toEqual([
      expect.objectContaining({
        'circle-stroke-width': 3,
        'circle-stroke-color': resultLayerColors.selectionOuter,
        'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0],
      }),
      expect.objectContaining({
        'circle-stroke-width': 1.5,
        'circle-stroke-color': resultLayerColors.selectionInner,
      }),
    ]);
  });
});

describe('hatchPattern', () => {
  test('линии под 45° цвета clay.3 с учётом pixelRatio', () => {
    const { width, height, data } = hatchPattern(2);
    const pixel = (x: number, y: number) =>
      Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));

    expect([width, height]).toEqual([16, 16]);
    expect(pixel(0, 0)).toEqual([0xd9, 0xa8, 0x9a, 255]);
    expect(pixel(1, 0)).toEqual([0xd9, 0xa8, 0x9a, 255]);
    expect(pixel(2, 0)).toEqual([0, 0, 0, 0]);
    // Линия продолжается через край плитки: картинка бесшовная.
    expect(pixel(15, 1)).toEqual([0xd9, 0xa8, 0x9a, 255]);
    expect(pixel(8, 8)[3]).toBe(255);
  });
});

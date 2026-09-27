import type { ExpressionSpecification } from 'maplibre-gl';
import { describe, expect, test } from 'vitest';

import { resultLayerColors } from '@/shared/theme';

import type {
  ObstaclesFeatureCollection,
  PlantingFeatureCollection,
  RejectedSitesFeatureCollection,
  ZonesFeatureCollection,
} from '../api/project-result-api';
import {
  crownRadiusExpression,
  dimensionLabelsMinZoom,
  hatchPattern,
  hedgeRows,
  manualDiamond,
  plantTypeFilters,
  RESULT_LAYER,
  RESULT_SOURCE,
  resultCounts,
  resultExtent,
  resultLayers,
  resultSources,
  statusRings,
  utilityLabelsMinZoom,
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
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: square(31, 50) },
      properties: { zone_type: 'lawn_raw' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: square(32, 50) },
      properties: { zone_type: 'base_area' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: square(33, 50) },
      properties: { zone_type: 'allowed', plant_type: 'tree' },
    },
  ],
};

const source = { status: 'auto', dxftype: 'LWPOLYLINE', rule_id: '3', handle: '2C7' };
const line = (y: number) => ({
  type: 'LineString' as const,
  coordinates: [
    [37.599, y],
    [37.601, y],
  ],
});
const obstacles: ObstaclesFeatureCollection = {
  type: 'FeatureCollection',
  metadata: { crs: 'EPSG:4326 (WGS84 lon/lat)' },
  features: [
    {
      type: 'Feature',
      geometry: line(55.7501),
      properties: { ...source, category: 'underground_utilities', subtype: 'gas', layer: 'Газ' },
    },
    {
      type: 'Feature',
      geometry: line(55.7502),
      properties: {
        ...source,
        category: 'underground_utilities',
        subtype: 'steam',
        layer: 'Пар',
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [37.6, 55.75] },
      properties: { ...source, category: 'wells_hatches', subtype: null, layer: 'Колодцы' },
    },
    {
      type: 'Feature',
      geometry: line(55.7503),
      properties: { ...source, category: 'road_edge', subtype: null, layer: 'Борт' },
    },
  ],
};

describe('источники и слои результата', () => {
  test('порядок снизу вверх: газон, «можно», здания, зоны, кромки и сети, граница, посадки, подписи сетей, размеры, выбор', () => {
    expect(resultLayers(LAT).map(({ id }) => id)).toEqual([
      RESULT_LAYER.lawn,
      RESULT_LAYER.allowed,
      RESULT_LAYER.buildings,
      RESULT_LAYER.buildingsOutline,
      RESULT_LAYER.zones,
      RESULT_LAYER.zonesHatch,
      RESULT_LAYER.zonesOutline,
      RESULT_LAYER.edges,
      RESULT_LAYER.utilitiesSolid,
      RESULT_LAYER.utilitiesDashed,
      RESULT_LAYER.utilitiesDashDot,
      RESULT_LAYER.siteBoundary,
      RESULT_LAYER.rejectedRing,
      RESULT_LAYER.rejectedCross,
      RESULT_LAYER.rejectedHit,
      RESULT_LAYER.hedges,
      RESULT_LAYER.shrubs,
      RESULT_LAYER.treeShadows,
      RESULT_LAYER.trees,
      RESULT_LAYER.treeHighlights,
      RESULT_LAYER.statusForbidden,
      RESULT_LAYER.statusRejected,
      RESULT_LAYER.manualMark,
      RESULT_LAYER.movedLine,
      RESULT_LAYER.editCrown,
      RESULT_LAYER.editForbidden,
      RESULT_LAYER.editRejected,
      RESULT_LAYER.utilityLabels,
      RESULT_LAYER.dimensionMargin,
      RESULT_LAYER.dimensionSetback,
      RESULT_LAYER.dimensionSetbackTicks,
      RESULT_LAYER.dimensionLabels,
      RESULT_LAYER.selectionOuter,
      RESULT_LAYER.selectionInner,
    ]);
  });

  test('газон, граница участка и «можно» — свой источник, без base_area и зон запрета', () => {
    const { data } = resultSources({ planting, zones }, null, null, new Map(), LAT)[
      RESULT_SOURCE.site
    ];

    expect(data).toMatchObject({
      features: [
        { properties: { zone_type: 'site_boundary' } },
        { properties: { zone_type: 'lawn_raw' } },
        { properties: { zone_type: 'allowed', plant_type: 'tree' } },
      ],
    });
    const layers = resultLayers(LAT);
    const filterOf = (id: string) => {
      const layer = layers.find((candidate) => candidate.id === id);
      return layer !== undefined && 'filter' in layer ? layer.filter : undefined;
    };
    expect(filterOf(RESULT_LAYER.lawn)).toEqual(['==', ['get', 'zone_type'], 'lawn_raw']);
    expect(filterOf(RESULT_LAYER.siteBoundary)).toEqual([
      '==',
      ['get', 'zone_type'],
      'site_boundary',
    ]);
  });

  test('посадки — с promoteId по id и радиусом кроны по типу', () => {
    const source = resultSources({ planting, zones }, null, null, new Map(), LAT)[
      RESULT_SOURCE.planting
    ];

    expect(source.promoteId).toBe('id');
    expect(source.data).toMatchObject({
      features: [
        { properties: { id: 'TREE_ROW_CURB-00001', crown_radius_m: 1.5 } },
        { properties: { id: 'SHRUB_FILL_LAWN-00001', crown_radius_m: 0.35 } },
      ],
    });
  });

  test('блик — только у деревьев, к северо-западу от центра кроны', () => {
    const { data } = resultSources({ planting, zones }, null, null, new Map(), LAT)[
      RESULT_SOURCE.highlights
    ];
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
    const { data } = resultSources({ planting, zones }, null, null, new Map(), LAT)[
      RESULT_SOURCE.zones
    ];

    expect(data).toMatchObject({
      features: [{ properties: { zone_type: 'prohibited', zone_index: 0 } }],
    });
    expect(
      resultSources({ planting, zones }, null, null, new Map(), LAT)[RESULT_SOURCE.zones].promoteId,
    ).toBe('zone_index');
    expect(resultExtent({ planting, zones })).toEqual({
      minX: 37.599,
      minY: 55.749,
      maxX: 37.601,
      maxY: 55.751,
    });
    expect(resultCounts({ planting, zones })).toEqual({
      trees: 1,
      shrubs: 1,
      zones: 1,
      zonesByType: { tree: 1, shrub: 0 },
    });
  });

  test('«можно» и зоны запрета — для выбранного типа посадки', () => {
    const layers = resultLayers(LAT);
    const filterOf = (id: string) => {
      const layer = layers.find((candidate) => candidate.id === id);
      return layer !== undefined && 'filter' in layer ? layer.filter : undefined;
    };

    // По умолчанию — деревья; переключатель подставляет фильтры другого типа.
    expect(filterOf(RESULT_LAYER.allowed)).toEqual(plantTypeFilters('tree')[RESULT_LAYER.allowed]);
    expect(filterOf(RESULT_LAYER.zonesHatch)).toEqual(['==', ['get', 'plant_type'], 'tree']);
    expect(plantTypeFilters('shrub')).toMatchObject({
      [RESULT_LAYER.allowed]: [
        'all',
        ['==', ['get', 'zone_type'], 'allowed'],
        ['==', ['get', 'plant_type'], 'shrub'],
      ],
      [RESULT_LAYER.zones]: ['==', ['get', 'plant_type'], 'shrub'],
      [RESULT_LAYER.zonesOutline]: ['==', ['get', 'plant_type'], 'shrub'],
    });
  });

  test('объекты: сети, кромки и здания с номером, цветом сети и подписью; остальное не рисуется', () => {
    const { data, promoteId } = resultSources({ planting, zones }, obstacles, null, new Map(), LAT)[
      RESULT_SOURCE.obstacles
    ];

    expect(promoteId).toBe('obstacle_index');
    expect(data).toMatchObject({
      features: [
        {
          properties: {
            obstacle_index: 0,
            group: 'utilities',
            utility: 'gas',
            color: '#8A6A2A',
            label: 'Газопровод',
          },
        },
        // Подтип без своего цвета — как неопознанная сеть, подпись — по категории.
        {
          properties: {
            obstacle_index: 1,
            utility: 'other_utility',
            label: 'Подземная сеть',
          },
        },
        { properties: { obstacle_index: 3, group: 'edges', label: 'Бортовой камень' } },
      ],
    });
    expect(
      resultSources({ planting, zones }, null, null, new Map(), LAT)[RESULT_SOURCE.obstacles].data,
    ).toMatchObject({ features: [] });
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

describe('знаки правок', () => {
  const planting: PlantingFeatureCollection = {
    type: 'FeatureCollection',
    metadata: { crs: 'EPSG:4326' },
    features: ['a', 'b', 'c', 'd'].map((id, index) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [37.6 + index * 0.001, LAT] },
      properties: { id, plant_type: index === 3 ? 'shrub' : 'tree', rule_id: 'R' },
    })),
  };

  test('кольца — только у нарушающих и вне области, чуть шире кроны', () => {
    const statuses = new Map([
      ['a', 'forbidden' as const],
      ['b', 'allowed' as const],
      ['d', 'rejected' as const],
    ]);

    const { features } = statusRings(planting, statuses, LAT);

    expect(features.map(({ id, properties }) => [id, properties.status])).toEqual([
      ['a', 'forbidden'],
      ['d', 'rejected'],
    ]);
    const [ring] = features;
    const [first, ...rest] = ring?.geometry.coordinates ?? [];
    // Замкнутое кольцо вокруг ствола радиусом кроны дерева 1,5 м плюс зазор 0,35 м.
    expect(rest.at(-1)).toEqual(first);
    const northmost = Math.max(...(ring?.geometry.coordinates.map(([, lat = 0]) => lat) ?? []));
    expect((northmost - LAT) * 111_320).toBeCloseTo(1.85, 2);
  });

  test('слои колец: сплошное и пунктирное clay.6, скрываются на время жеста', () => {
    const layers = resultLayers(LAT);
    const paint = (id: string) => {
      const layer = layers.find((candidate) => candidate.id === id);
      return layer?.type === 'line' ? layer.paint : undefined;
    };

    expect(paint(RESULT_LAYER.statusForbidden)).toMatchObject({
      'line-color': resultLayerColors.statusRing,
      'line-width': 2,
    });
    expect(paint(RESULT_LAYER.statusForbidden)).not.toHaveProperty('line-dasharray');
    expect(paint(RESULT_LAYER.statusRejected)).toHaveProperty('line-dasharray');
    expect(paint(RESULT_LAYER.statusRejected)?.['line-opacity']).toEqual(
      expect.arrayContaining([['boolean', ['feature-state', 'dragging'], false]]),
    );
  });

  test('ромб «добавлено вручную»: белый с тёмной обводкой, углы прозрачны', () => {
    const { width, height, data } = manualDiamond(2);
    const pixel = (x: number, y: number) =>
      Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));

    expect([width, height]).toEqual([18, 18]);
    expect(pixel(9, 9)).toEqual([255, 255, 255, 255]);
    expect(pixel(0, 0)[3]).toBe(0);
    // Край ромба по горизонтали — обводка stone.9.
    expect(pixel(0, 9)).toEqual([0x2e, 0x2a, 0x27, 255]);
  });
});

test('подписи размеров — с одного и того же числа пикселей на метр в Москве и у экватора', () => {
  // Москва: 18-й масштаб. План без геопривязки лежит у точки (0, 0): там метр на том же
  // масштабе мельче, и порог выше на log2(1 / cos φ).
  expect(dimensionLabelsMinZoom(55.75)).toBeCloseTo(18, 1);
  expect(dimensionLabelsMinZoom(0) - dimensionLabelsMinZoom(55.75)).toBeCloseTo(
    Math.log2(1 / Math.cos((55.75 * Math.PI) / 180)),
    5,
  );
  const labels = resultLayers(0).find(({ id }) => id === RESULT_LAYER.dimensionLabels);
  expect(labels?.minzoom).toBe(dimensionLabelsMinZoom(0));
});

test('подписи сетей — с 17-го масштаба в Москве, у экватора — с той же детальности', () => {
  expect(utilityLabelsMinZoom(55.75)).toBeCloseTo(17, 5);
  expect(utilityLabelsMinZoom(0) - utilityLabelsMinZoom(55.75)).toBeCloseTo(
    Math.log2(1 / Math.cos((55.75 * Math.PI) / 180)),
    5,
  );
});

describe('отклонённые места и живая изгородь', () => {
  const rejected: RejectedSitesFeatureCollection = {
    type: 'FeatureCollection',
    metadata: { crs: 'EPSG:4326 (WGS84 lon/lat)' },
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [37.6, LAT] },
        properties: {
          plant_type: 'tree',
          rule_id: 'TREE_FILL_LAWN',
          failed_checks: [
            {
              category: 'underground_utilities',
              subtype: 'gas',
              required_m: 1.5,
              actual_m: 0.9,
              citation: '743-ПП — газопровод',
            },
          ],
        },
      },
    ],
  };

  test('пунктирный круг радиусом кроны и косой крест; цель для щелчка — по номеру', () => {
    const sources = resultSources({ planting, zones }, null, rejected, new Map(), LAT);
    const { data } = sources[RESULT_SOURCE.rejected];
    if (typeof data === 'string' || data.type !== 'FeatureCollection') throw new Error('данные');
    const [ring, cross] = data.features;
    if (ring?.geometry.type !== 'LineString') throw new Error('ожидалось кольцо');

    const [first] = ring.geometry.coordinates;
    const [lon = 0, lat = 0] = first ?? [];
    // Первая вершина — на востоке, на радиусе кроны дерева 1,5 м.
    expect((lon - 37.6) * 111_320 * Math.cos((LAT * Math.PI) / 180)).toBeCloseTo(1.5, 3);
    expect(lat).toBeCloseTo(LAT, 9);
    expect(ring.geometry.coordinates.at(-1)?.[0]).toBeCloseTo(lon, 9);
    expect(cross?.geometry.type).toBe('MultiLineString');
    expect(sources[RESULT_SOURCE.rejectedPoints].promoteId).toBe('rejected_index');
  });

  test('слой отклонённых мест по умолчанию скрыт, линия — пунктир clay.6', () => {
    const ringLayer = resultLayers(LAT).find(({ id }) => id === RESULT_LAYER.rejectedRing);

    expect(ringLayer).toMatchObject({
      layout: { visibility: 'none' },
      paint: { 'line-color': resultLayerColors.rejected, 'line-dasharray': [2, 1.5] },
    });
  });

  const hedge = (id: string, x: number, y: number) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [x, y] },
    properties: { id, plant_type: 'shrub' as const, rule_id: 'SHRUB_HEDGE_CURB' },
  });
  const ids = (rows: ReturnType<typeof hedgeRows>) =>
    rows.map((row) => row.map(({ properties }) => properties.id));

  test('изгородь — ряды вдоль ряда; разрыв делит ряд', () => {
    const rows = hedgeRows({
      ...planting,
      features: [
        hedge('c', 3, 0),
        hedge('a', 1, 0),
        hedge('b', 2, 0),
        hedge('e', 21, 0),
        hedge('d', 20, 0),
        ...planting.features,
      ],
    });

    expect(ids(rows).map((row) => [...row].sort())).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e'],
    ]);
    expect(ids(rows)[0]?.[1]).toBe('b');
  });

  test('наклонный ряд, два параллельных ряда и дуга — без зигзагов между рядами', () => {
    // Два ряда под 5° в 3 шагах друг от друга и дуга радиусом 30 шагов.
    const angle = (5 * Math.PI) / 180;
    const tilted = Array.from({ length: 30 }, (_, index) => [
      hedge(`n${String(index)}`, index * Math.cos(angle), index * Math.sin(angle)),
      hedge(
        `s${String(index)}`,
        index * Math.cos(angle) + 3 * Math.sin(angle),
        index * Math.sin(angle) - 3 * Math.cos(angle),
      ),
    ]).flat();
    const arc = Array.from({ length: 30 }, (_, index) =>
      hedge(`a${String(index)}`, 100 + 30 * Math.cos(index / 30), 30 * Math.sin(index / 30)),
    );

    const rows = ids(hedgeRows({ ...planting, features: [...tilted, ...arc] }));

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      // В ряду только точки одного ряда, соседние по номеру.
      const prefix = row[0]?.charAt(0) ?? '';
      expect(row.every((id) => id.startsWith(prefix))).toBe(true);
      const numbers = row.map((id) => Number(id.slice(1)));
      for (let index = 1; index < numbers.length; index += 1) {
        expect(Math.abs((numbers[index] ?? 0) - (numbers[index - 1] ?? 0))).toBe(1);
      }
    }
  });
});

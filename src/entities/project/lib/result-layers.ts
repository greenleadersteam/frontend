import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSourceSpecification,
  LayerSpecification,
} from 'maplibre-gl';

import { MAP_MAX_ZOOM, MAP_MIN_ZOOM } from '@/shared/config';
import {
  MAP_LABEL_FONT,
  resultLayerColors as colors,
  type UtilityDash,
  utilityStyles,
  type UtilitySubtype,
} from '@/shared/theme';

import type {
  ObstaclesFeatureCollection,
  PlantingFeatureCollection,
  RejectedSitesFeatureCollection,
  ZonesFeatureCollection,
} from '../api/project-result-api';
import { obstacleLabel } from '../config/labels';
import type { PlantType } from '../model/project';
import {
  CROWN_RADIUS_M,
  type Extent,
  extentOf,
  MIN_CROWN_RADIUS_PX,
  pixelsPerMeterAtZoom,
  type Position,
} from './plan-projection';

export const RESULT_SOURCE = {
  site: 'result-site',
  planting: 'result-planting',
  highlights: 'result-tree-highlights',
  zones: 'result-prohibited-zones',
  obstacles: 'result-obstacles',
  hedges: 'result-hedges',
  rejected: 'result-rejected',
  rejectedPoints: 'result-rejected-points',
  dimensions: 'result-dimensions',
} as const;

export const HATCH_IMAGE = 'prohibited-hatch';

// Порядок снизу вверх — порядок в массиве слоёв ниже.
export const RESULT_LAYER = {
  lawn: 'lawn',
  allowed: 'allowed-area',
  buildings: 'obstacle-buildings',
  buildingsOutline: 'obstacle-buildings-outline',
  zones: 'prohibited-zones',
  zonesHatch: 'prohibited-zones-hatch',
  zonesOutline: 'prohibited-zones-outline',
  edges: 'obstacle-edges',
  utilitiesSolid: 'obstacle-utilities-solid',
  utilitiesDashed: 'obstacle-utilities-dashed',
  utilitiesDashDot: 'obstacle-utilities-dash-dot',
  siteBoundary: 'site-boundary',
  rejectedRing: 'rejected-ring',
  rejectedCross: 'rejected-cross',
  rejectedHit: 'rejected-hit',
  hedges: 'shrub-hedges',
  shrubs: 'shrubs',
  treeShadows: 'tree-shadows',
  trees: 'trees',
  treeHighlights: 'tree-highlights',
  dimensionMargin: 'dimension-margin',
  dimensionSetback: 'dimension-setback',
  dimensionSetbackTicks: 'dimension-setback-ticks',
  dimensionLabels: 'dimension-labels',
  utilityLabels: 'obstacle-utility-labels',
  selectionOuter: 'planting-selection-outer',
  selectionInner: 'planting-selection-inner',
} as const;

export type ResultLayerGroup =
  | 'trees'
  | 'shrubs'
  | 'zones'
  | 'allowed'
  | 'lawn'
  | 'siteBoundary'
  | 'utilities'
  | 'buildings'
  | 'edges'
  | 'rejected';

const UTILITY_LAYERS = [
  RESULT_LAYER.utilitiesSolid,
  RESULT_LAYER.utilitiesDashed,
  RESULT_LAYER.utilitiesDashDot,
];

export const RESULT_LAYER_GROUPS: Record<ResultLayerGroup, readonly string[]> = {
  trees: [RESULT_LAYER.treeShadows, RESULT_LAYER.trees, RESULT_LAYER.treeHighlights],
  shrubs: [RESULT_LAYER.hedges, RESULT_LAYER.shrubs],
  zones: [RESULT_LAYER.zones, RESULT_LAYER.zonesHatch, RESULT_LAYER.zonesOutline],
  allowed: [RESULT_LAYER.allowed],
  lawn: [RESULT_LAYER.lawn],
  siteBoundary: [RESULT_LAYER.siteBoundary],
  utilities: [...UTILITY_LAYERS, RESULT_LAYER.utilityLabels],
  buildings: [RESULT_LAYER.buildings, RESULT_LAYER.buildingsOutline],
  edges: [RESULT_LAYER.edges],
  rejected: [RESULT_LAYER.rejectedRing, RESULT_LAYER.rejectedCross, RESULT_LAYER.rejectedHit],
};

export const SELECTABLE_LAYERS = [RESULT_LAYER.trees, RESULT_LAYER.shrubs];

// Исходные объекты, по которым можно щёлкнуть: линии сетей и кромок, здания.
export const OBSTACLE_LAYERS = [...UTILITY_LAYERS, RESULT_LAYER.edges, RESULT_LAYER.buildings];

// Какие объекты /obstacles рисуются на плане: сети, здания, бортовой камень и тротуары.
// Остальные категории (колодцы, горизонтали, пункты) участвуют только в проверках.
export type ObstacleGroup = 'utilities' | 'buildings' | 'edges';

export function obstacleGroup(category: string): ObstacleGroup | null {
  switch (category) {
    case 'underground_utilities':
      return 'utilities';
    case 'buildings':
      return 'buildings';
    case 'road_edge':
    case 'footpath_edge':
      return 'edges';
    default:
      return null;
  }
}

const isUtilitySubtype = (value: string): value is UtilitySubtype =>
  Object.hasOwn(utilityStyles, value);

// Подтип без своего цвета рисуется как неопознанная сеть.
export const utilityStyleOf = (subtype: string | null): UtilitySubtype =>
  subtype !== null && isUtilitySubtype(subtype) ? subtype : 'other_utility';

// Разрешённая область и зоны запрета показываются для одного типа посадки.
export function plantTypeFilters(plantType: PlantType): Record<string, FilterSpecification> {
  const zones: FilterSpecification = ['==', ['get', 'plant_type'], plantType];
  return {
    [RESULT_LAYER.allowed]: [
      'all',
      ['==', ['get', 'zone_type'], 'allowed'],
      ['==', ['get', 'plant_type'], plantType],
    ],
    [RESULT_LAYER.zones]: zones,
    [RESULT_LAYER.zonesHatch]: zones,
    [RESULT_LAYER.zonesOutline]: zones,
  };
}

export type ResultData = { planting: PlantingFeatureCollection; zones: ZonesFeatureCollection };

type ZoneFeature = ZonesFeatureCollection['features'][number];

const prohibitedZones = (zones: ZonesFeatureCollection): ZoneFeature[] =>
  zones.features.filter(({ properties }) => properties.zone_type === 'prohibited');

// Газон и граница участка — по одному признаку в /zones, разрешённая область — по признаку на
// тип посадки (../backend/greenplan/export/zones.py:43-72).
const SITE_ZONE_TYPES: readonly string[] = ['lawn_raw', 'site_boundary', 'allowed'];

const positionsOf = ({ geometry }: ZoneFeature): Position[] =>
  geometry.type === 'Polygon' ? geometry.coordinates.flat() : geometry.coordinates.flat(2);

// Охват зон запрета и посадок — то, во что карта вписывается при открытии.
export const resultExtent = ({ planting, zones }: ResultData): Extent | null =>
  extentOf([
    ...prohibitedZones(zones).flatMap(positionsOf),
    ...planting.features.map(({ geometry }) => geometry.coordinates),
  ]);

// Живая изгородь — правило ряда кустарников вдоль борта (../backend/greenplan/layout/default.yaml:25-28).
// Групповых посадок-полигонов в контракте нет: изгородь рисуется полосой по её точкам.
export const HEDGE_RULE = 'SHRUB_HEDGE_CURB';

type Planting = PlantingFeatureCollection['features'][number];

// Ряды изгороди — цепочки ближайших соседей: от конца ряда к ближайшей непосещённой точке.
// Так ряд идёт вдоль борта любой формы. Ряд рвётся, если соседняя точка дальше полутора
// типичных шагов (медиана расстояний до ближайшего соседа): изгороди по разные стороны борта
// стоят дальше друг от друга, чем точки внутри ряда. Долгота сжата косинусом широты, чтобы
// градусы карты по осям весили одинаково.
export function hedgeRows(planting: PlantingFeatureCollection): Planting[][] {
  const points = planting.features.filter(({ properties }) => properties.rule_id === HEDGE_RULE);
  if (points.length < 2) return [];
  const [, latitude = 0] = points[0]?.geometry.coordinates ?? [];
  const scale = Math.cos((latitude * Math.PI) / 180);
  const xy = points.map(({ geometry }) => {
    const [x = 0, y = 0] = geometry.coordinates;
    return [x * scale, y] as const;
  });
  const gap = (a: number, b: number) => {
    const [ax = 0, ay = 0] = xy[a] ?? [];
    const [bx = 0, by = 0] = xy[b] ?? [];
    return Math.hypot(ax - bx, ay - by);
  };
  // Сетка точек: соседей ищем в своей и восьми соседних ячейках, а не среди всех точек —
  // вдоль бортов крупного участка точек изгороди тысячи.
  const gridOf = (cell: number) => {
    const cells = new Map<string, number[]>();
    const keyOf = (x: number, y: number) =>
      `${String(Math.floor(x / cell))}:${String(Math.floor(y / cell))}`;
    xy.forEach(([x, y], index) => {
      const key = keyOf(x, y);
      const bucket = cells.get(key);
      if (bucket === undefined) cells.set(key, [index]);
      else bucket.push(index);
    });
    return (index: number) => {
      const [x = 0, y = 0] = xy[index] ?? [];
      const found: number[] = [];
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          found.push(...(cells.get(keyOf(x + dx * cell, y + dy * cell)) ?? []));
        }
      }
      return found.filter((other) => other !== index);
    };
  };
  // Сетка строится один раз на размер ячейки.
  const grids = new Map<number, ReturnType<typeof gridOf>>();
  const gridAt = (cell: number) => {
    const known = grids.get(cell);
    if (known !== undefined) return known;
    const built = gridOf(cell);
    grids.set(cell, built);
    return built;
  };
  // Типичный шаг — по ближайшему соседу; ячейка для его поиска растёт, пока сосед не найден.
  const nearestGap = xy.map((_, index) => {
    for (let cell = 1e-5; ; cell *= 4) {
      const around = gridAt(cell)(index);
      if (around.length > 0 || cell > 1) {
        return Math.min(Infinity, ...around.map((other) => gap(index, other)));
      }
    }
  });
  const typical = [...nearestGap].sort((a, b) => a - b)[Math.floor(nearestGap.length / 2)] ?? 0;
  const threshold = 1.5 * typical;
  const near = gridOf(threshold);
  const adjacent = xy.map((_, index) =>
    near(index)
      .filter((other) => gap(index, other) <= threshold)
      .sort((a, b) => gap(index, a) - gap(index, b)),
  );

  const unvisited = new Set(xy.keys());
  const neighbours = (a: number) => (adjacent[a] ?? []).filter((b) => unvisited.has(b));
  const rows: Planting[][] = [];
  while (unvisited.size > 0) {
    // Начало ряда — точка с одним соседом (конец ряда), иначе любая.
    const start =
      [...unvisited].find((candidate) => neighbours(candidate).length === 1) ??
      [...unvisited][0] ??
      0;
    unvisited.delete(start);
    const row = [start];
    for (let current = start; ;) {
      const [next] = neighbours(current);
      if (next === undefined) break;
      unvisited.delete(next);
      row.push(next);
      current = next;
    }
    rows.push(row.flatMap((index) => points[index] ?? []));
  }
  return rows.filter((row) => row.length > 1);
}

export const resultCounts = ({ planting, zones }: ResultData) => {
  const prohibited = prohibitedZones(zones);
  const zonesFor = (plantType: PlantType) =>
    prohibited.filter(
      ({ properties }) =>
        properties.zone_type === 'prohibited' && properties.plant_type === plantType,
    ).length;
  return {
    trees: planting.features.filter(({ properties }) => properties.plant_type === 'tree').length,
    shrubs: planting.features.filter(({ properties }) => properties.plant_type === 'shrub').length,
    zones: prohibited.length,
    zonesByType: { tree: zonesFor('tree'), shrub: zonesFor('shrub') },
  };
};

const METERS_PER_DEGREE = 111_320;

// Прозрачность «можно» подобрана по скриншоту с подложкой и без: область читается поверх
// газона и не спорит со штриховкой зон запрета.
const ALLOWED_OPACITY = 0.55;

// Круг радиусом в метрах вокруг точки карты — ломаной: у круговых слоёв MapLibre нет пунктира.
const RING_STEPS = 32;

function ringAround([lon = 0, lat = 0]: readonly number[], radiusM: number, metersToLon: number) {
  return Array.from({ length: RING_STEPS + 1 }, (_, step) => {
    const angle = (step / RING_STEPS) * 2 * Math.PI;
    return [
      lon + radiusM * Math.cos(angle) * metersToLon,
      lat + (radiusM * Math.sin(angle)) / METERS_PER_DEGREE,
    ];
  });
}

// Косой крест внутри круга: отклонённое место отличается от посадки формой, а не только цветом.
function crossAt([lon = 0, lat = 0]: readonly number[], halfM: number, metersToLon: number) {
  const dx = halfM * metersToLon;
  const dy = halfM / METERS_PER_DEGREE;
  return [
    [
      [lon - dx, lat - dy],
      [lon + dx, lat + dy],
    ],
    [
      [lon - dx, lat + dy],
      [lon + dx, lat - dy],
    ],
  ];
}

// Блик — кружок 0,45 радиуса, смещённый на 0,3 радиуса к северо-западу, как в превью
// (draw-plan.ts). Смещение задаётся в метрах на местности, поэтому верно на любом масштабе.
export function resultSources(
  { planting, zones }: ResultData,
  // Объекты подосновы и отклонённые места в координатах карты; null — сервер их не отдаёт.
  obstacles: ObstaclesFeatureCollection | null,
  rejected: RejectedSitesFeatureCollection | null,
  latitude: number,
): Record<(typeof RESULT_SOURCE)[keyof typeof RESULT_SOURCE], GeoJSONSourceSpecification> {
  const plantingFeatures = planting.features.map((feature) => ({
    ...feature,
    properties: {
      ...feature.properties,
      crown_radius_m: CROWN_RADIUS_M[feature.properties.plant_type],
    },
  }));
  const metersToLon = 1 / (METERS_PER_DEGREE * Math.cos((latitude * Math.PI) / 180));
  const highlights = plantingFeatures
    .filter(({ properties }) => properties.plant_type === 'tree')
    .map(({ geometry, properties }) => {
      const [lon = 0, lat = 0] = geometry.coordinates;
      const offset = 0.3 * properties.crown_radius_m;
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [lon - offset * metersToLon, lat + offset / METERS_PER_DEGREE],
        },
        properties: { crown_radius_m: 0.45 * properties.crown_radius_m },
      };
    });

  return {
    [RESULT_SOURCE.site]: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: zones.features.filter(({ properties }) =>
          SITE_ZONE_TYPES.includes(properties.zone_type),
        ),
      },
    },
    [RESULT_SOURCE.planting]: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: plantingFeatures },
      // Выбор посадки — feature-state по её id, без пересоздания источника.
      promoteId: 'id',
    },
    [RESULT_SOURCE.highlights]: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: highlights },
    },
    [RESULT_SOURCE.zones]: {
      type: 'geojson',
      // Номер зоны среди зон запрета — тот же, что в prepareZones: по нему зона выделяется.
      data: {
        type: 'FeatureCollection',
        features: prohibitedZones(zones).map((feature, index) => ({
          ...feature,
          properties: { ...feature.properties, zone_index: index },
        })),
      },
      promoteId: 'zone_index',
    },
    [RESULT_SOURCE.obstacles]: {
      type: 'geojson',
      // Номер объекта — его позиция в /obstacles, как в prepareObstacles: по нему он выделяется.
      data: {
        type: 'FeatureCollection',
        features: (obstacles?.features ?? []).flatMap((feature, index) => {
          const { category, subtype } = feature.properties;
          const group = obstacleGroup(category);
          if (group === null) return [];
          return [
            {
              type: 'Feature' as const,
              geometry: feature.geometry,
              properties: {
                obstacle_index: index,
                group,
                utility: utilityStyleOf(subtype),
                color: utilityStyles[utilityStyleOf(subtype)].color,
                // Подпись — из словаря интерфейса, а не из данных сервера.
                label: obstacleLabel(category, subtype),
              },
            },
          ];
        }),
      },
      promoteId: 'obstacle_index',
    },
    [RESULT_SOURCE.hedges]: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: hedgeRows(planting).map((row) => ({
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: row.map(({ geometry }) => geometry.coordinates),
          },
          // Ширина полосы — диаметр кроны кустарника.
          properties: { width_m: 2 * CROWN_RADIUS_M.shrub },
        })),
      },
    },
    [RESULT_SOURCE.rejected]: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: (rejected?.features ?? []).flatMap(({ geometry, properties }, index) => {
          const radius = CROWN_RADIUS_M[properties.plant_type];
          return [
            {
              type: 'Feature' as const,
              geometry: {
                type: 'LineString' as const,
                coordinates: ringAround(geometry.coordinates, radius, metersToLon),
              },
              properties: { rejected_index: index, part: 'ring' },
            },
            {
              type: 'Feature' as const,
              geometry: {
                type: 'MultiLineString' as const,
                coordinates: crossAt(geometry.coordinates, 0.35 * radius, metersToLon),
              },
              properties: { rejected_index: index, part: 'cross' },
            },
          ];
        }),
      },
    },
    [RESULT_SOURCE.rejectedPoints]: {
      type: 'geojson',
      // Невидимый круг радиусом кроны — цель для щелчка и выделения места.
      data: {
        type: 'FeatureCollection',
        features: (rejected?.features ?? []).map(({ geometry, properties }, index) => ({
          type: 'Feature' as const,
          geometry,
          properties: {
            rejected_index: index,
            crown_radius_m: CROWN_RADIUS_M[properties.plant_type],
          },
        })),
      },
      promoteId: 'rejected_index',
    },
    [RESULT_SOURCE.dimensions]: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    },
  };
}

const ZOOM_STOPS = Array.from(
  { length: MAP_MAX_ZOOM - MAP_MIN_ZOOM + 1 },
  (_, index) => MAP_MIN_ZOOM + index,
);

type RadiusOptions = {
  latitude: number;
  offsetPx?: number;
  minPx?: number;
  // Свойство с размером в метрах: радиус кроны или ширина полосы изгороди.
  property?: string;
};

// Радиус кроны в метрах на местности → пиксели: на каждом целом zoom значение считается
// по pixelsPerMeterAtZoom, между ними interpolate с основанием 2 даёт то же удвоение.
// Выражение ["zoom"] допустимо только на верхнем уровне, поэтому минимум — внутри остановок.
export function crownRadiusExpression({
  latitude,
  offsetPx = 0,
  minPx = MIN_CROWN_RADIUS_PX,
  property = 'crown_radius_m',
}: RadiusOptions): ExpressionSpecification {
  const stops = ZOOM_STOPS.flatMap((zoom): [number, ExpressionSpecification] => [
    zoom,
    ['+', offsetPx, ['max', minPx, ['*', ['get', property], pixelsPerMeterAtZoom(zoom, latitude)]]],
  ]);
  return ['interpolate', ['exponential', 2], ['zoom'], ...stops];
}

const byType = (plantType: 'tree' | 'shrub'): ExpressionSpecification => [
  '==',
  ['get', 'plant_type'],
  plantType,
];

const selectedOpacity: ExpressionSpecification = [
  'case',
  ['boolean', ['feature-state', 'selected'], false],
  1,
  0,
];

// Кольца выбора: обводка MapLibre рисуется снаружи радиуса, поэтому белое кольцо 3px
// прилегает к кроне, а тёмное 1,5px — снаружи белого (design.md, «Карта»).
function selectionRing(
  id: string,
  latitude: number,
  offsetPx: number,
  width: number,
  color: string,
): CircleLayerSpecification {
  return {
    id,
    type: 'circle',
    source: RESULT_SOURCE.planting,
    paint: {
      'circle-radius': crownRadiusExpression({ latitude, offsetPx }),
      'circle-opacity': 0,
      'circle-stroke-width': width,
      'circle-stroke-color': color,
      'circle-stroke-opacity': selectedOpacity,
    },
  };
}

const selected = (on: number, off: number): ExpressionSpecification => [
  'case',
  ['boolean', ['feature-state', 'selected'], false],
  on,
  off,
];

const byGroup = (group: ObstacleGroup): ExpressionSpecification => ['==', ['get', 'group'], group];

// Рисунок линии сети — в долях её толщины. Разные рисунки — отдельные слои: у line-dasharray
// нет выражений по данным.
const UTILITY_DASHES: Record<UtilityDash, number[] | null> = {
  solid: null,
  dashed: [3, 2],
  dashDot: [5, 2, 1, 2],
};

function utilityLayer(id: string, dash: UtilityDash): LayerSpecification {
  const subtypes = Object.entries(utilityStyles)
    .filter(([, style]) => style.dash === dash)
    .map(([subtype]) => subtype);
  const dasharray = UTILITY_DASHES[dash];
  return {
    id,
    type: 'line',
    source: RESULT_SOURCE.obstacles,
    filter: ['all', byGroup('utilities'), ['in', ['get', 'utility'], ['literal', subtypes]]],
    paint: {
      'line-color': ['get', 'color'],
      'line-width': selected(3, 1.5),
      ...(dasharray !== null && { 'line-dasharray': dasharray }),
    },
  };
}

// Подписи сетей — с масштаба 17 в Москве. Порог — в пикселях на метр, как у подписей размеров:
// план без геопривязки лежит у экватора, где номер масштаба значит другое.
const UTILITY_LABELS_ZOOM = 17;
const MOSCOW_LATITUDE = 55.75;

export const utilityLabelsMinZoom = (latitude: number): number =>
  Math.log2(
    pixelsPerMeterAtZoom(UTILITY_LABELS_ZOOM, MOSCOW_LATITUDE) / pixelsPerMeterAtZoom(0, latitude),
  );

export function resultLayers(latitude: number): LayerSpecification[] {
  const radius = crownRadiusExpression({ latitude });
  const filters = plantTypeFilters('tree');
  return [
    // Газон читается на подложке, но не спорит с её парками: заливка без обводки, полупрозрачная.
    {
      id: RESULT_LAYER.lawn,
      type: 'fill',
      source: RESULT_SOURCE.site,
      filter: ['==', ['get', 'zone_type'], 'lawn_raw'],
      paint: { 'fill-color': colors.lawn, 'fill-opacity': 0.7 },
    },
    // «Можно» — поверх газона и полупрозрачно: газон — где вообще зелень, «можно» — где
    // разрешено сажать выбранный тип; видны оба.
    {
      id: RESULT_LAYER.allowed,
      type: 'fill',
      source: RESULT_SOURCE.site,
      filter: filters[RESULT_LAYER.allowed],
      paint: { 'fill-color': colors.allowed, 'fill-opacity': ALLOWED_OPACITY },
    },
    // Здания — под зонами запрета: сами зоны от них не строятся, а линии сетей ложатся сверху.
    {
      id: RESULT_LAYER.buildings,
      type: 'fill',
      source: RESULT_SOURCE.obstacles,
      filter: byGroup('buildings'),
      paint: { 'fill-color': colors.building },
    },
    {
      id: RESULT_LAYER.buildingsOutline,
      type: 'line',
      source: RESULT_SOURCE.obstacles,
      filter: byGroup('buildings'),
      paint: { 'line-color': colors.buildingOutline, 'line-width': selected(2, 1) },
    },
    {
      id: RESULT_LAYER.zones,
      type: 'fill',
      source: RESULT_SOURCE.zones,
      filter: filters[RESULT_LAYER.zones],
      paint: { 'fill-color': colors.prohibitedZone, 'fill-opacity': 0.25 },
    },
    {
      id: RESULT_LAYER.zonesHatch,
      type: 'fill',
      source: RESULT_SOURCE.zones,
      filter: filters[RESULT_LAYER.zonesHatch],
      paint: { 'fill-pattern': HATCH_IMAGE },
    },
    // Выбранная зона запрета — усиленная обводка.
    {
      id: RESULT_LAYER.zonesOutline,
      type: 'line',
      source: RESULT_SOURCE.zones,
      filter: filters[RESULT_LAYER.zonesOutline],
      paint: { 'line-color': colors.zoneOutline, 'line-width': selected(2, 0) },
    },
    {
      id: RESULT_LAYER.edges,
      type: 'line',
      source: RESULT_SOURCE.obstacles,
      filter: byGroup('edges'),
      paint: { 'line-color': colors.edge, 'line-width': selected(2.5, 1) },
    },
    utilityLayer(RESULT_LAYER.utilitiesSolid, 'solid'),
    utilityLayer(RESULT_LAYER.utilitiesDashed, 'dashed'),
    utilityLayer(RESULT_LAYER.utilitiesDashDot, 'dashDot'),
    // Граница участка — над заливками, под посадками; пунктир с длинным штрихом, как на чертеже.
    {
      id: RESULT_LAYER.siteBoundary,
      type: 'line',
      source: RESULT_SOURCE.site,
      filter: ['==', ['get', 'zone_type'], 'site_boundary'],
      paint: {
        'line-color': colors.siteBoundary,
        'line-width': 1.5,
        'line-dasharray': [8, 3],
      },
    },
    // Отклонённые места — пунктирный круг кроны с косым крестом (design.md, «Карта»).
    {
      id: RESULT_LAYER.rejectedRing,
      type: 'line',
      source: RESULT_SOURCE.rejected,
      filter: ['==', ['get', 'part'], 'ring'],
      layout: { visibility: 'none' },
      paint: {
        'line-color': colors.rejected,
        'line-width': 1.5,
        'line-dasharray': [2, 1.5],
      },
    },
    {
      id: RESULT_LAYER.rejectedCross,
      type: 'line',
      source: RESULT_SOURCE.rejected,
      filter: ['==', ['get', 'part'], 'cross'],
      layout: { visibility: 'none' },
      paint: { 'line-color': colors.rejected, 'line-width': 1.5 },
    },
    // Выбранное место — заливка кроны clay.6: круг-цель без выбора прозрачен.
    {
      id: RESULT_LAYER.rejectedHit,
      type: 'circle',
      source: RESULT_SOURCE.rejectedPoints,
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': radius,
        'circle-color': colors.rejected,
        'circle-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.2, 0],
      },
    },
    // Живая изгородь — полоса шириной в крону под кругами кустарников.
    {
      id: RESULT_LAYER.hedges,
      type: 'line',
      source: RESULT_SOURCE.hedges,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': colors.shrub,
        'line-opacity': 0.6,
        'line-width': crownRadiusExpression({ latitude, property: 'width_m' }),
      },
    },
    {
      id: RESULT_LAYER.shrubs,
      type: 'circle',
      source: RESULT_SOURCE.planting,
      filter: byType('shrub'),
      paint: { 'circle-radius': radius, 'circle-color': colors.shrub },
    },
    {
      id: RESULT_LAYER.treeShadows,
      type: 'circle',
      source: RESULT_SOURCE.planting,
      filter: byType('tree'),
      paint: {
        'circle-radius': radius,
        'circle-color': colors.treeShadow,
        'circle-opacity': 0.18,
        'circle-blur': 0.6,
        'circle-translate': [1, 2],
      },
    },
    {
      id: RESULT_LAYER.trees,
      type: 'circle',
      source: RESULT_SOURCE.planting,
      filter: byType('tree'),
      paint: { 'circle-radius': radius, 'circle-color': colors.tree },
    },
    {
      id: RESULT_LAYER.treeHighlights,
      type: 'circle',
      source: RESULT_SOURCE.highlights,
      // Блик на мелком масштабе исчезает, а не закрывает крону минимальным кружком.
      paint: {
        'circle-radius': crownRadiusExpression({ latitude, minPx: 0 }),
        'circle-color': colors.treeHighlight,
      },
    },
    {
      id: RESULT_LAYER.utilityLabels,
      type: 'symbol',
      source: RESULT_SOURCE.obstacles,
      minzoom: utilityLabelsMinZoom(latitude),
      filter: byGroup('utilities'),
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'label'],
        'text-font': MAP_LABEL_FONT,
        'text-size': 11,
        'text-offset': [0, -0.8],
      },
      paint: {
        'text-color': colors.obstacleLabel,
        'text-halo-color': colors.obstacleLabelHalo,
        'text-halo-width': 1.5,
      },
    },
    ...dimensionLayers(latitude),
    selectionRing(RESULT_LAYER.selectionOuter, latitude, 0, 3, colors.selectionOuter),
    selectionRing(RESULT_LAYER.selectionInner, latitude, 3, 1.5, colors.selectionInner),
  ];
}

const byDimension = (
  kinds: readonly ('line' | 'tick')[],
  parts: readonly ('margin' | 'setback' | 'distance' | 'norm')[],
): ExpressionSpecification => [
  'all',
  ['in', ['get', 'kind'], ['literal', kinds]],
  ['in', ['get', 'part'], ['literal', parts]],
];

// Ограничение под курсором толще, остальные бледнее (design.md, «Карта»).
const dimensionWidth: ExpressionSpecification = [
  'case',
  ['==', ['get', 'emphasis'], 'focus'],
  2.5,
  1.5,
];
const dimensionOpacity: ExpressionSpecification = [
  'case',
  ['==', ['get', 'emphasis'], 'dim'],
  0.4,
  1,
];

// Размерные линии выбранной посадки: «запас» и расстояние до объекта — сплошная sage.7,
// «охранная зона» — пунктир clay.6, засечки на концах, подписи длины посередине. Отметка нормы
// на отрезке до объекта — штрих clay.6.
// Подписи размеров видны, когда в метре не меньше 6 пикселей (в Москве — с 18-го масштаба):
// мельче отрезки в метры короче подписи, и она ложится на крону. Порог — в пикселях на метр,
// а не в номере масштаба: план без геопривязки лежит у экватора, где масштаб другой.
const DIMENSION_LABEL_PX_PER_M = 6;

export const dimensionLabelsMinZoom = (latitude: number): number =>
  Math.log2(DIMENSION_LABEL_PX_PER_M / pixelsPerMeterAtZoom(0, latitude));

function dimensionLayers(latitude: number): LayerSpecification[] {
  const line = (id: string, filter: ExpressionSpecification, color: string, dashed: boolean) =>
    ({
      id,
      type: 'line',
      source: RESULT_SOURCE.dimensions,
      filter,
      paint: {
        'line-color': color,
        'line-width': dimensionWidth,
        'line-opacity': dimensionOpacity,
        ...(dashed && { 'line-dasharray': [3, 2] }),
      },
    }) satisfies LayerSpecification;
  return [
    line(
      RESULT_LAYER.dimensionMargin,
      byDimension(['line', 'tick'], ['margin', 'distance']),
      colors.dimensionMargin,
      false,
    ),
    line(
      RESULT_LAYER.dimensionSetback,
      byDimension(['line'], ['setback']),
      colors.dimensionSetback,
      true,
    ),
    line(
      RESULT_LAYER.dimensionSetbackTicks,
      byDimension(['tick'], ['setback', 'norm']),
      colors.dimensionSetback,
      false,
    ),
    {
      id: RESULT_LAYER.dimensionLabels,
      type: 'symbol',
      source: RESULT_SOURCE.dimensions,
      minzoom: dimensionLabelsMinZoom(latitude),
      filter: ['==', ['get', 'kind'], 'label'],
      layout: {
        'text-field': ['get', 'text'],
        'text-font': MAP_LABEL_FONT,
        'text-size': 12,
        'text-offset': [0, -0.9],
        // Подписи не накладываются: при столкновении остаётся выделенная, затем ближайшая,
        // у одной проверки — подпись длины, а не охранной зоны или нормы.
        'symbol-sort-key': [
          'case',
          ['==', ['get', 'emphasis'], 'focus'],
          -1,
          [
            '+',
            ['*', 2, ['get', 'check']],
            ['case', ['in', ['get', 'part'], ['literal', ['setback', 'norm']]], 1, 0],
          ],
        ],
      },
      paint: {
        'text-color': colors.dimensionLabel,
        'text-halo-color': colors.dimensionLabelHalo,
        'text-halo-width': 1.5,
        'text-opacity': dimensionOpacity,
      },
    },
  ];
}

const HATCH_STEP_PX = 8;

// Штриховка под 45°: линии x + y = const с шагом 8 CSS-пикселей толщиной в один. Картинка
// рисуется в физических пикселях экрана и отдаётся в addImage вместе с pixelRatio.
export function hatchPattern(pixelRatio: number): {
  width: number;
  height: number;
  data: Uint8Array;
} {
  const size = Math.round(HATCH_STEP_PX * pixelRatio);
  const lineWidth = Math.max(1, Math.round(pixelRatio));
  const [red, green, blue] = [1, 3, 5].map((start) =>
    Number.parseInt(colors.prohibitedZone.slice(start, start + 2), 16),
  );
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if ((x + y) % size >= lineWidth) continue;
      const offset = (y * size + x) * 4;
      data.set([red ?? 0, green ?? 0, blue ?? 0, 255], offset);
    }
  }
  return { width: size, height: size, data };
}

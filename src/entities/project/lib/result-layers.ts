import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  GeoJSONSourceSpecification,
  LayerSpecification,
} from 'maplibre-gl';

import { MAP_MAX_ZOOM, MAP_MIN_ZOOM } from '@/shared/config';
import { resultLayerColors as colors } from '@/shared/theme';

import type { PlantingFeatureCollection, ZonesFeatureCollection } from '../api/project-result-api';
import {
  CROWN_RADIUS_M,
  type Extent,
  extentOf,
  MIN_CROWN_RADIUS_PX,
  pixelsPerMeterAtZoom,
  type Position,
} from './plan-projection';

export const RESULT_SOURCE = {
  planting: 'result-planting',
  highlights: 'result-tree-highlights',
  zones: 'result-prohibited-zones',
} as const;

export const HATCH_IMAGE = 'prohibited-hatch';

// Порядок снизу вверх — порядок в массиве слоёв ниже.
export const RESULT_LAYER = {
  zones: 'prohibited-zones',
  zonesHatch: 'prohibited-zones-hatch',
  shrubs: 'shrubs',
  treeShadows: 'tree-shadows',
  trees: 'trees',
  treeHighlights: 'tree-highlights',
  selectionOuter: 'planting-selection-outer',
  selectionInner: 'planting-selection-inner',
} as const;

export type ResultLayerGroup = 'trees' | 'shrubs' | 'zones';

export const RESULT_LAYER_GROUPS: Record<ResultLayerGroup, readonly string[]> = {
  trees: [RESULT_LAYER.treeShadows, RESULT_LAYER.trees, RESULT_LAYER.treeHighlights],
  shrubs: [RESULT_LAYER.shrubs],
  zones: [RESULT_LAYER.zones, RESULT_LAYER.zonesHatch],
};

export const SELECTABLE_LAYERS = [RESULT_LAYER.trees, RESULT_LAYER.shrubs];

type ResultData = { planting: PlantingFeatureCollection; zones: ZonesFeatureCollection };

type ZoneFeature = ZonesFeatureCollection['features'][number];

const prohibitedZones = (zones: ZonesFeatureCollection): ZoneFeature[] =>
  zones.features.filter(({ properties }) => properties.zone_type === 'prohibited');

const positionsOf = ({ geometry }: ZoneFeature): Position[] =>
  geometry.type === 'Polygon' ? geometry.coordinates.flat() : geometry.coordinates.flat(2);

// Охват зон запрета и посадок — то, во что карта вписывается при открытии.
export const resultExtent = ({ planting, zones }: ResultData): Extent | null =>
  extentOf([
    ...prohibitedZones(zones).flatMap(positionsOf),
    ...planting.features.map(({ geometry }) => geometry.coordinates),
  ]);

export const resultCounts = ({ planting, zones }: ResultData) => ({
  trees: planting.features.filter(({ properties }) => properties.plant_type === 'tree').length,
  shrubs: planting.features.filter(({ properties }) => properties.plant_type === 'shrub').length,
  zones: prohibitedZones(zones).length,
});

const METERS_PER_DEGREE = 111_320;

// Блик — кружок 0,45 радиуса, смещённый на 0,3 радиуса к северо-западу, как в превью
// (draw-plan.ts). Смещение задаётся в метрах на местности, поэтому верно на любом масштабе.
export function resultSources(
  { planting, zones }: ResultData,
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
      data: { type: 'FeatureCollection', features: prohibitedZones(zones) },
    },
  };
}

const ZOOM_STOPS = Array.from(
  { length: MAP_MAX_ZOOM - MAP_MIN_ZOOM + 1 },
  (_, index) => MAP_MIN_ZOOM + index,
);

type RadiusOptions = { latitude: number; offsetPx?: number; minPx?: number };

// Радиус кроны в метрах на местности → пиксели: на каждом целом zoom значение считается
// по pixelsPerMeterAtZoom, между ними interpolate с основанием 2 даёт то же удвоение.
// Выражение ["zoom"] допустимо только на верхнем уровне, поэтому минимум — внутри остановок.
export function crownRadiusExpression({
  latitude,
  offsetPx = 0,
  minPx = MIN_CROWN_RADIUS_PX,
}: RadiusOptions): ExpressionSpecification {
  const stops = ZOOM_STOPS.flatMap((zoom): [number, ExpressionSpecification] => [
    zoom,
    [
      '+',
      offsetPx,
      ['max', minPx, ['*', ['get', 'crown_radius_m'], pixelsPerMeterAtZoom(zoom, latitude)]],
    ],
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

export function resultLayers(latitude: number): LayerSpecification[] {
  const radius = crownRadiusExpression({ latitude });
  return [
    {
      id: RESULT_LAYER.zones,
      type: 'fill',
      source: RESULT_SOURCE.zones,
      paint: { 'fill-color': colors.prohibitedZone, 'fill-opacity': 0.25 },
    },
    {
      id: RESULT_LAYER.zonesHatch,
      type: 'fill',
      source: RESULT_SOURCE.zones,
      paint: { 'fill-pattern': HATCH_IMAGE },
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
    selectionRing(RESULT_LAYER.selectionOuter, latitude, 0, 3, colors.selectionOuter),
    selectionRing(RESULT_LAYER.selectionInner, latitude, 3, 1.5, colors.selectionInner),
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

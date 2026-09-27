import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';

import { georeferenceColors as colors } from '@/shared/theme';

export const CONTOUR_SOURCE = {
  contour: 'georeference-contour',
  vertices: 'georeference-vertices',
  anchor: 'georeference-anchor',
  lever: 'georeference-lever',
  sector: 'georeference-sector',
} as const;

export const CONTOUR_LAYER = {
  vertices: 'georeference-vertices',
  leverHalo: 'georeference-lever-halo',
  lever: 'georeference-lever',
  fill: 'georeference-contour-fill',
  halo: 'georeference-contour-halo',
  line: 'georeference-contour-line',
} as const;

// По заливке и линии контур захватывается мышью: при нулевой заливке — хотя бы за линию.
export const GRAB_LAYERS = [CONTOUR_LAYER.fill, CONTOUR_LAYER.halo];

export const DEFAULT_FILL_OPACITY = 0.15;

const layers = (fillOpacity: number): LayerSpecification[] => [
  {
    id: CONTOUR_LAYER.fill,
    type: 'fill',
    source: CONTOUR_SOURCE.contour,
    paint: { 'fill-color': colors.contourFill, 'fill-opacity': fillOpacity },
  },
  {
    id: 'georeference-sector-fill',
    type: 'fill',
    source: CONTOUR_SOURCE.sector,
    paint: { 'fill-color': colors.sector, 'fill-opacity': 0.12 },
  },
  {
    id: CONTOUR_LAYER.halo,
    type: 'line',
    source: CONTOUR_SOURCE.contour,
    layout: { 'line-join': 'round' },
    paint: { 'line-color': colors.contourHalo, 'line-width': 5 },
  },
  {
    id: CONTOUR_LAYER.line,
    type: 'line',
    source: CONTOUR_SOURCE.contour,
    layout: { 'line-join': 'round' },
    paint: { 'line-color': colors.contour, 'line-width': 2 },
  },
  {
    id: CONTOUR_LAYER.leverHalo,
    type: 'line',
    source: CONTOUR_SOURCE.lever,
    paint: { 'line-color': colors.leverHalo, 'line-width': 4 },
  },
  {
    id: CONTOUR_LAYER.lever,
    type: 'line',
    source: CONTOUR_SOURCE.lever,
    paint: { 'line-color': colors.lever, 'line-width': 1.5, 'line-dasharray': [3, 2] },
  },
  {
    id: CONTOUR_LAYER.vertices,
    type: 'circle',
    source: CONTOUR_SOURCE.vertices,
    paint: {
      'circle-radius': 3,
      'circle-color': colors.vertex,
      'circle-stroke-color': colors.vertexOutline,
      'circle-stroke-width': 1.5,
    },
  },
  // Опорная точка — кольцо с точкой: видна и на снимке, и на схеме.
  {
    id: 'georeference-anchor-halo',
    type: 'circle',
    source: CONTOUR_SOURCE.anchor,
    paint: {
      'circle-radius': 7,
      'circle-color': colors.anchorHalo,
      'circle-stroke-color': colors.anchor,
      'circle-stroke-width': 2,
    },
  },
  {
    id: 'georeference-anchor',
    type: 'circle',
    source: CONTOUR_SOURCE.anchor,
    paint: { 'circle-radius': 2.5, 'circle-color': colors.anchor },
  },
];

// Рычаг ручки поворота: его прячут вместе с ручкой.
export const LEVER_LAYERS: readonly string[] = [CONTOUR_LAYER.leverHalo, CONTOUR_LAYER.lever];

// Слои, которые скрывает переключатель «Контур» в панели «Слои».
export const CONTOUR_LAYERS = layers(0).map(({ id }) => id);

export function addContourLayers(map: MapLibreMap, fillOpacity: number): void {
  for (const source of Object.values(CONTOUR_SOURCE)) {
    map.addSource(source, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }
  for (const layer of layers(fillOpacity)) map.addLayer(layer);
}

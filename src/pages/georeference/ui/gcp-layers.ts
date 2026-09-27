import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';

import { georeferenceColors as colors, MAP_LABEL_FONT } from '@/shared/theme';

import { CONTOUR_LAYER } from './contour-layers';

export const GCP_SOURCE = {
  pairs: 'georeference-pairs',
  rubber: 'georeference-rubber',
  snap: 'georeference-snap',
  vectors: 'georeference-vectors',
  references: 'georeference-references',
} as const;

export const GCP_LAYER = {
  pairs: 'georeference-pairs',
  pairsHot: 'georeference-pairs-hot',
} as const;

// Эталоны — под контуром: это отпечатки для сравнения, а двигают контур.
const referenceLayers: LayerSpecification[] = [
  {
    id: 'georeference-references-halo',
    type: 'line',
    source: GCP_SOURCE.references,
    paint: { 'line-color': colors.referenceHalo, 'line-width': 4 },
  },
  {
    id: 'georeference-references',
    type: 'line',
    source: GCP_SOURCE.references,
    paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [4, 2] },
  },
];

// Пары, резинка и векторы — над контуром.
const pairLayers: LayerSpecification[] = [
  {
    id: 'georeference-vectors-halo',
    type: 'line',
    source: GCP_SOURCE.vectors,
    paint: { 'line-color': colors.controlHalo, 'line-width': 3.5 },
  },
  {
    id: 'georeference-vectors',
    type: 'line',
    source: GCP_SOURCE.vectors,
    paint: {
      'line-color': colors.control,
      'line-width': 1.5,
      // Вектор контрольной точки — пунктиром: он не участвует в подгонке.
      'line-dasharray': ['case', ['get', 'control'], ['literal', [2, 1.5]], ['literal', [1, 0]]],
    },
  },
  {
    id: 'georeference-rubber',
    type: 'line',
    source: GCP_SOURCE.rubber,
    paint: { 'line-color': colors.control, 'line-width': 1.5, 'line-dasharray': [3, 2] },
  },
  {
    id: 'georeference-snap',
    type: 'circle',
    source: GCP_SOURCE.snap,
    paint: {
      'circle-radius': 7,
      'circle-color': 'transparent',
      'circle-stroke-color': colors.control,
      'circle-stroke-width': 2,
    },
  },
  // Точка, наведённая в таблице или на карте, — крупнее.
  {
    id: GCP_LAYER.pairsHot,
    type: 'circle',
    source: GCP_SOURCE.pairs,
    filter: ['==', ['get', 'id'], ''],
    paint: {
      'circle-radius': 10,
      'circle-color': colors.controlHalo,
      'circle-stroke-color': colors.control,
      'circle-stroke-width': 2,
    },
  },
  {
    id: GCP_LAYER.pairs,
    type: 'circle',
    source: GCP_SOURCE.pairs,
    paint: {
      'circle-radius': 5,
      // Контрольная — залитая, учтённая — полая; выброс — цветом ошибки, выключенная — бледнее.
      'circle-color': ['case', ['get', 'control'], colors.control, colors.controlHalo],
      'circle-stroke-color': ['case', ['get', 'outlier'], colors.outlier, colors.control],
      'circle-stroke-width': 2,
      'circle-opacity': ['case', ['get', 'enabled'], 1, 0.45],
      'circle-stroke-opacity': ['case', ['get', 'enabled'], 1, 0.45],
    },
  },
  {
    id: 'georeference-pairs-label',
    type: 'symbol',
    source: GCP_SOURCE.pairs,
    layout: {
      'text-field': ['get', 'label'],
      'text-font': MAP_LABEL_FONT,
      'text-size': 12,
      'text-offset': [0.9, -0.9],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': colors.control,
      'text-halo-color': colors.controlHalo,
      'text-halo-width': 1.5,
    },
  },
];

export function addGcpLayers(map: MapLibreMap): void {
  for (const source of Object.values(GCP_SOURCE)) {
    map.addSource(source, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  for (const layer of referenceLayers) map.addLayer(layer, CONTOUR_LAYER.fill);
  for (const layer of pairLayers) map.addLayer(layer);
}

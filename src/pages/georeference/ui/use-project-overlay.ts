import type { GeoJSONSource, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { useEffect } from 'react';

import type { Placement } from '@/shared/lib/georeference';
import { resultLayerColors as colors } from '@/shared/theme';

import { overlayFeatures, type ProjectOverlay } from '../lib/project-overlay';
import { CONTOUR_LAYER } from './contour-layers';

const OVERLAY_SOURCE = {
  zones: 'georeference-project-zones',
  plantings: 'georeference-project-plantings',
} as const;

// Цвета — как на плане проекта, но бледнее: подсказка не должна спорить со снимком и контуром.
const OVERLAY_LAYERS: LayerSpecification[] = [
  {
    id: 'georeference-project-zones',
    type: 'fill',
    source: OVERLAY_SOURCE.zones,
    paint: { 'fill-color': colors.prohibitedZone, 'fill-opacity': 0.35 },
  },
  {
    id: 'georeference-project-zones-line',
    type: 'line',
    source: OVERLAY_SOURCE.zones,
    paint: { 'line-color': colors.zoneOutline, 'line-width': 0.75, 'line-opacity': 0.5 },
  },
  {
    id: 'georeference-project-plantings',
    type: 'circle',
    source: OVERLAY_SOURCE.plantings,
    paint: {
      'circle-radius': 3,
      'circle-color': ['match', ['get', 'plant_type'], 'tree', colors.tree, colors.shrub],
      'circle-opacity': 0.7,
    },
  },
];

type ProjectOverlayOptions = {
  map: MapLibreMap | null;
  // null — модуль открыт не из проекта: плана под контуром нет.
  overlay: ProjectOverlay | null;
  placement: Placement | null;
  visible: boolean;
};

// План проекта под контуром. Пересчитывается по положению из Redux — после отпускания мыши,
// клавиши или пары точек, а не на каждый кадр жеста: сотня тысяч вершин не успела бы за кадром.
// Слои добавляются до слоёв опорных точек и эталонов (useGcpMap вызывается после), поэтому
// лежат под ними и под контуром.
export function useProjectOverlay({
  map,
  overlay,
  placement,
  visible,
}: ProjectOverlayOptions): void {
  const shown = overlay !== null;

  useEffect(() => {
    if (map === null || !shown) return;
    for (const source of Object.values(OVERLAY_SOURCE)) {
      map.addSource(source, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    for (const layer of OVERLAY_LAYERS) map.addLayer(layer, CONTOUR_LAYER.fill);
  }, [map, shown]);

  // Зависимости — числа положения, а не объект сессии: эталон или масштаб работ меняют сессию,
  // но не положение, и сотню тысяч вершин пересчитывать незачем.
  const lat = placement?.anchor.lat;
  const lon = placement?.anchor.lon;
  const rotation = placement?.rotation;
  const scale = placement?.scale;
  const x = placement?.source.center.x;
  const y = placement?.source.center.y;
  useEffect(() => {
    if (map === null || overlay === null) return;
    if (lat === undefined || lon === undefined || rotation === undefined) return;
    if (scale === undefined || x === undefined || y === undefined) return;
    const { zones, plantings } = overlayFeatures(overlay, {
      anchor: { lat, lon },
      rotation,
      scale,
      source: { center: { x, y } },
    });
    void map.getSource<GeoJSONSource>(OVERLAY_SOURCE.zones)?.setData(zones);
    void map.getSource<GeoJSONSource>(OVERLAY_SOURCE.plantings)?.setData(plantings);
  }, [map, overlay, lat, lon, rotation, scale, x, y]);

  useEffect(() => {
    if (map === null || !shown) return;
    for (const { id } of OVERLAY_LAYERS) {
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
  }, [map, shown, visible]);
}

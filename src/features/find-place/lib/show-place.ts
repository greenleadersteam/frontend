import type { Map as MapLibreMap } from 'maplibre-gl';

export type PlaceTarget =
  | { kind: 'point'; lat: number; lon: number }
  | { kind: 'bounds'; bounds: [west: number, south: number, east: number, north: number] };

// Масштаб, на котором видно здание и двор: к точке без охвата карта приближается до него.
const POINT_ZOOM = 17;
// Охват дома или улицы вписывается не ближе этого: иначе карта уходит в пустые тайлы.
const BOUNDS_MAX_ZOOM = 18;

// Карта перелетает к найденному месту: к точке — на масштаб двора, охват — вписывает.
export function showPlace(
  map: Pick<MapLibreMap, 'flyTo' | 'fitBounds' | 'getZoom'>,
  target: PlaceTarget,
): void {
  switch (target.kind) {
    case 'point':
      map.flyTo({ center: [target.lon, target.lat], zoom: Math.max(map.getZoom(), POINT_ZOOM) });
      return;
    case 'bounds':
      map.fitBounds(target.bounds, { maxZoom: BOUNDS_MAX_ZOOM });
      return;
    default: {
      const unexpected: never = target;
      return unexpected;
    }
  }
}

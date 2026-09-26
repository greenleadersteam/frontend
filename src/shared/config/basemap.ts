// Масштабы карты: подложка собрана до zoom 15, выше тайлы перемасштабируются.
export const MAP_MIN_ZOOM = 9;
export const MAP_MAX_ZOOM = 20;

// Охват Москвы с Новой Москвой — примерно 36,80–37,97° в. д. и 55,14–56,02° с. ш. по границе
// субъекта в OSM — с запасом около 0,2°, чтобы участок у границы города не упирался в край.
export const BASEMAP_BOUNDS: [west: number, south: number, east: number, north: number] = [
  36.6, 54.95, 38.2, 56.2,
];

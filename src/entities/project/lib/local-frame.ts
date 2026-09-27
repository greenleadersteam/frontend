import type { Extent, Position } from './plan-projection';

// Точка в локальных метрах вокруг центра участка: x — на восток, y — на север.
export type LocalPoint = readonly [x: number, y: number];

export type LocalFrame = {
  // Координаты данных (WGS84 или метры чертежа) → локальные метры.
  toLocal: (position: Position) => LocalPoint;
  // Локальные метры → координаты карты MapLibre.
  toMap: (point: LocalPoint) => [lon: number, lat: number];
  geographic: boolean;
};

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

// Длина градуса на эллипсоиде WGS84 на широте φ (ряды для меридиана и параллели): на участке
// в пределах километра равнопромежуточная проекция от центра даёт погрешность меньше 0,03 %.
function metersPerDegree(latitude: number): { lon: number; lat: number } {
  const phi = toRadians(latitude);
  return {
    lat: 111_132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi),
    lon: 111_412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi),
  };
}

// Радиус сферы Web Mercator — той, на которой MapLibre строит карту.
const MERCATOR_RADIUS_M = 6_378_137;

// Метры чертежа → условные lon/lat у экватора по обратной формуле Web Mercator. Масштаб
// Меркатора на широте φ — 1/cos φ; на расстоянии 1 км от экватора это 1 + 1,2·10⁻⁸, так что
// метры, масштабная линейка и радиусы крон на такой «карте» остаются метрами.
const drawingToMap = ([x, y]: LocalPoint): [number, number] => [
  toDegrees(x / MERCATOR_RADIUS_M),
  toDegrees(2 * Math.atan(Math.exp(y / MERCATOR_RADIUS_M)) - Math.PI / 2),
];

// Система координат плана: WGS84 проецируется в метры от центра участка; метры чертежа
// сдвигаются в центр и показываются на карте у точки (0, 0).
export function createLocalFrame(extent: Extent, geographic: boolean): LocalFrame {
  const centerX = (extent.minX + extent.maxX) / 2;
  const centerY = (extent.minY + extent.maxY) / 2;

  if (!geographic) {
    return {
      geographic,
      toLocal: ([x = 0, y = 0]) => [x - centerX, y - centerY],
      toMap: drawingToMap,
    };
  }
  const scale = metersPerDegree(centerY);
  return {
    geographic,
    toLocal: ([lon = 0, lat = 0]) => [(lon - centerX) * scale.lon, (lat - centerY) * scale.lat],
    toMap: ([x, y]) => [centerX + x / scale.lon, centerY + y / scale.lat],
  };
}

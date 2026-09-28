import { metersPerDegree, WGS84 } from '@/shared/lib/geodesy';
import type { LocalPoint } from '@/shared/lib/geometry';
import { type PlacementCore, placementTransform } from '@/shared/lib/georeference';

import type { Extent, Position } from './plan-projection';

export type LocalFrame = {
  // Координаты данных (WGS84 или метры чертежа) → локальные метры.
  toLocal: (position: Position) => LocalPoint;
  // Локальные метры → координаты карты MapLibre.
  toMap: (point: LocalPoint) => [lon: number, lat: number];
  // Обратно: координаты карты → локальные метры и локальные метры → координаты данных. Нужны
  // правке расстановки: курсор приходит в координатах карты, правка хранится в координатах данных.
  fromMap: (lngLat: readonly [number, number]) => LocalPoint;
  toData: (point: LocalPoint) => [number, number];
  // Данные в WGS84: у проекта с геопривязкой сервера.
  geographic: boolean;
  // Координаты карты — настоящие WGS84: у проекта с геопривязкой сервера или с ручной привязкой.
  // Тогда под планом подложка города.
  onCity: boolean;
};

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

// Радиус сферы Web Mercator — той, на которой MapLibre строит карту: большая полуось WGS 84.
const MERCATOR_RADIUS_M = WGS84.A;

// Метры чертежа → условные lon/lat у экватора по обратной формуле Web Mercator. Масштаб
// Меркатора на широте φ — 1/cos φ; на расстоянии 1 км от экватора это 1 + 1,2·10⁻⁸, так что
// метры, масштабная линейка и радиусы крон на такой «карте» остаются метрами.
const drawingToMap = ([x, y]: LocalPoint): [number, number] => [
  toDegrees(x / MERCATOR_RADIUS_M),
  toDegrees(2 * Math.atan(Math.exp(y / MERCATOR_RADIUS_M)) - Math.PI / 2),
];

const mapToDrawing = ([lon, lat]: readonly [number, number]): LocalPoint => [
  toRadians(lon) * MERCATOR_RADIUS_M,
  Math.log(Math.tan(Math.PI / 4 + toRadians(lat) / 2)) * MERCATOR_RADIUS_M,
];

// Система координат плана: WGS84 проецируется в метры от центра участка; метры чертежа
// сдвигаются в центр и показываются на карте у точки (0, 0) или, с ручной привязкой, на своём
// месте в городе.
//
// Ручная привязка меняет только путь на карту и обратно: локальные метры — это по-прежнему метры
// чертежа, и проверки норм, правки и слой DXF считаются там же, где без неё.
export function createLocalFrame(
  extent: Extent,
  geographic: boolean,
  placement: PlacementCore | null = null,
): LocalFrame {
  const centerX = (extent.minX + extent.maxX) / 2;
  const centerY = (extent.minY + extent.maxY) / 2;

  if (!geographic) {
    const toLocal = ([x = 0, y = 0]: readonly number[]): LocalPoint => [x - centerX, y - centerY];
    const toData = ([x, y]: LocalPoint): [number, number] => [x + centerX, y + centerY];
    if (placement === null) {
      return {
        geographic,
        onCity: false,
        toLocal,
        toMap: drawingToMap,
        fromMap: mapToDrawing,
        toData,
      };
    }
    // Полный путь через эллипсоид, без линеаризации: на участке в 2 км касательная плоскость
    // в градусах отходит от линейной формулы на 0,35 м, а 1,1 млн вершин «Олимпийского» проходят
    // этот путь в браузере примерно за 430 мс при пороге 500 мс — один раз на смену привязки.
    const { toLatLon, toLocal: fromLatLon } = placementTransform(placement);
    return {
      geographic,
      onCity: true,
      toLocal,
      toMap: ([x, y]) => {
        const { lat, lon } = toLatLon({ x: x + centerX, y: y + centerY });
        return [lon, lat];
      },
      fromMap: ([lon, lat]) => {
        const { x, y } = fromLatLon({ lat, lon });
        return [x - centerX, y - centerY];
      },
      toData,
    };
  }
  // Равнопромежуточная проекция от центра: на участке в пределах километра погрешность меньше
  // 0,03 %.
  const scale = metersPerDegree(centerY);
  return {
    geographic,
    onCity: true,
    toLocal: ([lon = 0, lat = 0]) => [(lon - centerX) * scale.lon, (lat - centerY) * scale.lat],
    toMap: ([x, y]) => [centerX + x / scale.lon, centerY + y / scale.lat],
    fromMap: ([lon, lat]) => [(lon - centerX) * scale.lon, (lat - centerY) * scale.lat],
    toData: ([x, y]) => [centerX + x / scale.lon, centerY + y / scale.lat],
  };
}

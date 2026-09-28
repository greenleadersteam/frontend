import type {
  ObstaclesFeatureCollection,
  RejectedSitesFeatureCollection,
} from '../api/project-result-api';
import type { LocalFrame } from './local-frame';
import type { Position } from './plan-projection';
import type { ResultData } from './result-layers';

// Для карты MapLibre: у проекта с геопривязкой данные уже в WGS84, у проекта без неё метры
// чертежа переводятся в условные lon/lat у точки (0, 0) — та же карта, без подложки, — или,
// с ручной привязкой, в WGS84 по ней.
// Зоны и посадки переводятся отдельно: у «Олимпийского» в зонах 1,1 млн вершин, и правка
// посадки не должна пересчитывать их заново.
export function toMapZones(zones: ResultData['zones'], frame: LocalFrame): ResultData['zones'] {
  if (frame.geographic) return zones;
  const move = (position: Position) => frame.toMap(frame.toLocal(position));
  return {
    ...zones,
    features: zones.features.map((feature) => ({
      ...feature,
      geometry:
        feature.geometry.type === 'Polygon'
          ? {
              type: 'Polygon',
              coordinates: feature.geometry.coordinates.map((ring) => ring.map(move)),
            }
          : {
              type: 'MultiPolygon',
              coordinates: feature.geometry.coordinates.map((polygon) =>
                polygon.map((ring) => ring.map(move)),
              ),
            },
    })),
  };
}

// Посадки — любого расширения PlantingFeatureCollection: у расстановки с правками свойства
// правок доходят до карты.
export function toMapPlanting<Planting extends ResultData['planting']>(
  planting: Planting,
  frame: LocalFrame,
): Planting {
  if (frame.geographic) return planting;
  return {
    ...planting,
    features: planting.features.map((feature) => ({
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: frame.toMap(frame.toLocal(feature.geometry.coordinates)),
      },
    })),
  };
}

export function toMapData<Data extends ResultData>(data: Data, frame: LocalFrame): Data {
  if (frame.geographic) return data;
  return {
    ...data,
    planting: toMapPlanting(data.planting, frame),
    zones: toMapZones(data.zones, frame),
  };
}

type ObstacleGeometry = ObstaclesFeatureCollection['features'][number]['geometry'];

function moveGeometry(geometry: ObstacleGeometry, move: (position: Position) => number[]) {
  switch (geometry.type) {
    case 'Point':
      return { ...geometry, coordinates: move(geometry.coordinates) };
    case 'LineString':
      return { ...geometry, coordinates: geometry.coordinates.map(move) };
    case 'MultiLineString':
    case 'Polygon':
      return { ...geometry, coordinates: geometry.coordinates.map((line) => line.map(move)) };
    case 'MultiPolygon':
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => ring.map(move))),
      };
    default: {
      const unexpected: never = geometry;
      return unexpected;
    }
  }
}

// Объекты подосновы — в те же координаты карты, что посадки и зоны.
export function toMapObstacles(
  obstacles: ObstaclesFeatureCollection,
  frame: LocalFrame,
): ObstaclesFeatureCollection {
  if (frame.geographic) return obstacles;
  const move = (position: Position) => frame.toMap(frame.toLocal(position));
  return {
    ...obstacles,
    features: obstacles.features.map((feature) => ({
      ...feature,
      geometry: moveGeometry(feature.geometry, move),
    })),
  };
}

// Отклонённые места — в координаты карты, как посадки.
export function toMapRejected(
  rejected: RejectedSitesFeatureCollection,
  frame: LocalFrame,
): RejectedSitesFeatureCollection {
  if (frame.geographic) return rejected;
  return {
    ...rejected,
    features: rejected.features.map((feature) => ({
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: frame.toMap(frame.toLocal(feature.geometry.coordinates)),
      },
    })),
  };
}

import {
  area,
  boundaryIndex,
  isInside,
  type LocalPoint,
  type LocalPolygon,
  nearestOnBoundary,
} from '@/shared/lib/geometry';

import type { ZonesFeatureCollection } from '../api/project-result-api';
import type { PlantType } from '../model/project';
import type { LocalFrame } from './local-frame';
import type { Position } from './plan-projection';

type ZoneFeature = ZonesFeatureCollection['features'][number];
type ProhibitedProperties = Extract<ZoneFeature['properties'], { zone_type: 'prohibited' }>;

export type ProhibitedZone = {
  // Порядковый номер среди зон запрета: по нему зона выделяется на карте (feature-state).
  index: number;
  properties: ProhibitedProperties;
  polygons: LocalPolygon[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

export type PreparedZones = {
  zones: ProhibitedZone[];
  // Допустимая область (газон ∩ граница участка): по ней бэкенд обрезает буферы.
  baseArea: LocalPolygon[] | null;
  // Газон целиком, до обрезки границей участка.
  lawn: LocalPolygon[] | null;
  // Лежит ли точка на границе допустимой области — там буфер срезан краем участка.
  onBaseBoundary: ((point: LocalPoint) => boolean) | null;
  // Где посадка разрешена: допустимая область за вычетом буферов (zoning/engine.py:131-140).
  allowed: Partial<Record<PlantType, LocalPolygon[]>>;
  // Порог отбора зон по охвату: тройная наибольшая норма для типа посадки.
  threshold: Record<PlantType, number>;
};

export type PlantingCheck =
  // Расстояние до препятствия измерено: запас до зоны плюс её норма.
  | {
      kind: 'measured';
      zone: ProhibitedZone;
      margin: number;
      actual: number;
      planting: LocalPoint;
      boundary: LocalPoint;
      // Точка препятствия на продолжении; нет, если посадка стоит на самой кромке зоны.
      obstacle: LocalPoint | null;
    }
  // Ближайшая часть буфера могла быть срезана краем участка: честно — только до зоны.
  | {
      kind: 'boundary';
      zone: ProhibitedZone;
      margin: number;
      planting: LocalPoint;
      boundary: LocalPoint;
    }
  // Посадка внутри зоны запрета — дефект данных.
  | { kind: 'inside'; zone: ProhibitedZone };

// Совпадение точек после перепроекции бэкендом (UTM → WGS84) и нашей проекции — сантиметры.
const TOLERANCE_M = 0.02;
// Ячейка индекса границы: много больше допуска и мельче типичного отрезка.
const BASE_INDEX_CELL_M = 1;

const toPolygons = (geometry: ZoneFeature['geometry'], frame: LocalFrame): LocalPolygon[] =>
  (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates).map((polygon) =>
    polygon.map((ring) => ring.map((position: Position) => frame.toLocal(position))),
  );

function boundsOf(polygons: LocalPolygon[]): ProhibitedZone['bounds'] {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const polygon of polygons) {
    for (const [x, y] of polygon[0] ?? []) {
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.maxY = Math.max(bounds.maxY, y);
    }
  }
  return bounds;
}

// Один раз на загрузку данных: зоны в локальных метрах с охватами для грубого отбора.
// Порог — тройная наибольшая норма: дальше этого зона не «рядом» и в списке проверок только
// мешала бы; ближе — попадают все ограничения, которые могли повлиять на место посадки.
export function prepareZones(data: ZonesFeatureCollection, frame: LocalFrame): PreparedZones {
  const zones: ProhibitedZone[] = [];
  let baseArea: LocalPolygon[] | null = null;
  let lawn: LocalPolygon[] | null = null;
  const allowed: PreparedZones['allowed'] = {};
  for (const { geometry, properties } of data.features) {
    if (properties.zone_type === 'base_area') baseArea = toPolygons(geometry, frame);
    if (properties.zone_type === 'lawn_raw') lawn = toPolygons(geometry, frame);
    if (properties.zone_type === 'allowed') {
      allowed[properties.plant_type] = toPolygons(geometry, frame);
    }
    if (properties.zone_type !== 'prohibited') continue;
    const polygons = toPolygons(geometry, frame);
    zones.push({ index: zones.length, properties, polygons, bounds: boundsOf(polygons) });
  }
  const maxDistance = (plantType: PlantType) =>
    Math.max(
      0,
      ...zones
        .filter(({ properties }) => properties.plant_type === plantType)
        .map(({ properties }) => properties.distance_m),
    );
  // Граница допустимой области на крупном участке — десятки тысяч вершин: без индекса
  // проверка срезанных отрезков перебирала бы её целиком для каждого отрезка зоны.
  const nearBase = baseArea === null ? null : boundaryIndex(baseArea, BASE_INDEX_CELL_M);
  return {
    zones,
    baseArea,
    lawn,
    onBaseBoundary: nearBase === null ? null : (point: LocalPoint) => nearBase(point, TOLERANCE_M),
    allowed,
    threshold: { tree: 3 * maxDistance('tree'), shrub: 3 * maxDistance('shrub') },
  };
}

const distanceToBounds = ([x, y]: LocalPoint, bounds: ProhibitedZone['bounds']) =>
  Math.hypot(
    Math.max(bounds.minX - x, 0, x - bounds.maxX),
    Math.max(bounds.minY - y, 0, y - bounds.maxY),
  );

// Отрезок лежит на границе допустимой области — это срез буфера краем участка.
const cutEdge =
  (onBaseBoundary: (point: LocalPoint) => boolean) => (a: LocalPoint, b: LocalPoint) =>
    [a, b, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const].every(onBaseBoundary);

// Бэкенд строит зону как буфер препятствия радиусом distance_m и обрезает её допустимой
// областью (../backend/greenplan/zoning/engine.py:131-138). Для точки вне буфера расстояние до
// препятствия = distance_m + расстояние до буфера. Измеряем по несрезанной части границы, а
// точным считаем, только если круг радиусом «запас» вокруг посадки целиком внутри допустимой
// области: тогда ближе к посадке не может быть срезанной части буфера.
function checkZone(
  planting: LocalPoint,
  zone: ProhibitedZone,
  onBaseBoundary: PreparedZones['onBaseBoundary'],
  distanceToBase: number,
): PlantingCheck | null {
  const anyEdge = nearestOnBoundary(planting, zone.polygons);
  if (anyEdge === null) return null;
  // Миллиметры внутри — округление координат при экспорте, а не нарушение: на «Олимпийском»
  // одна посадка из 7 784 стоит в 2 мм за кромкой зоны.
  if (isInside(planting, zone.polygons) && anyEdge.distance > TOLERANCE_M) {
    return { kind: 'inside', zone };
  }

  const buffered =
    onBaseBoundary === null
      ? null
      : nearestOnBoundary(planting, zone.polygons, cutEdge(onBaseBoundary));
  if (buffered === null || distanceToBase + TOLERANCE_M < buffered.distance) {
    return {
      kind: 'boundary',
      zone,
      margin: anyEdge.distance,
      planting,
      boundary: anyEdge.point,
    };
  }

  const r = zone.properties.distance_m;
  const margin = buffered.distance;
  const obstacle: LocalPoint | null =
    margin === 0
      ? null
      : [
          planting[0] + ((buffered.point[0] - planting[0]) / margin) * (margin + r),
          planting[1] + ((buffered.point[1] - planting[1]) / margin) * (margin + r),
        ];
  return {
    kind: 'measured',
    zone,
    margin,
    actual: margin + r,
    planting,
    boundary: buffered.point,
    obstacle,
  };
}

const marginOf = (check: PlantingCheck) => (check.kind === 'inside' ? -Infinity : check.margin);

// Ограничения рядом с посадкой — самое напряжённое сверху.
export function checksForPlanting(
  planting: LocalPoint,
  plantType: PlantType,
  { zones, baseArea, onBaseBoundary, threshold }: PreparedZones,
): PlantingCheck[] {
  const nearby = zones.filter(
    ({ properties, bounds }) =>
      properties.plant_type === plantType &&
      distanceToBounds(planting, bounds) <= threshold[plantType],
  );
  if (nearby.length === 0) return [];
  const distanceToBase =
    baseArea !== null && isInside(planting, baseArea)
      ? (nearestOnBoundary(planting, baseArea)?.distance ?? 0)
      : 0;
  return nearby
    .flatMap((zone) => {
      const check = checkZone(planting, zone, onBaseBoundary, distanceToBase);
      return check === null ? [] : [check];
    })
    .sort((a, b) => marginOf(a) - marginOf(b));
}

// Площадь зоны на плане, м²: по её полигонам в локальных метрах.
export const zoneArea = (zone: ProhibitedZone): number => area(zone.polygons);

// Площадь, закрытая для посадки этого типа, м². Зоны разных препятствий перекрываются, и сумма
// их площадей завысила бы итог; объединение зон — допустимая область без разрешённой.
export function prohibitedArea({ baseArea, allowed }: PreparedZones, plantType: PlantType): number {
  if (baseArea === null) return 0;
  return area(baseArea) - area(allowed[plantType] ?? []);
}

// Площадь газона, м²; null — газона в данных нет.
export const lawnArea = ({ lawn }: PreparedZones): number | null =>
  lawn === null ? null : area(lawn);

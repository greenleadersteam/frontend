import {
  area,
  boundaryDistance,
  boundaryIndex,
  isInside,
  type LocalPoint,
  type LocalPolygon,
  nearestOnBoundary,
  type PolygonIndex,
  polygonIndex,
} from '@/shared/lib/geometry';

import type { Norm, ZonesFeatureCollection } from '../api/project-result-api';
import type { PlantType } from '../model/project';
import type { LocalFrame } from './local-frame';
import type { PreparedObstacle } from './obstacle-checks';
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
  // Расстояние до границы допустимой области, но не больше limit (по сеточному индексу).
  distanceToBase: ((point: LocalPoint, limit: number) => number) | null;
  // Индекс границы зоны: строится при первой проверке рядом с ней.
  zoneIndex: (zone: ProhibitedZone) => PolygonIndex;
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
  | { kind: 'inside'; zone: ProhibitedZone }
  // Расстояние до объекта из /obstacles — прямо до его геометрии, без зон.
  | {
      kind: 'object';
      category: string;
      subtype: string | null;
      actual: number;
      required: number;
      citation: string;
      norm: Norm | null;
      // Ближе нормы: по решению сервера или по своему расчёту с допуском TOLERANCE_M.
      violated: boolean;
      // Нет, если сервер назвал объект, которого рядом нет в /obstacles: тогда нет и линии.
      obstacle: PreparedObstacle | null;
      planting: LocalPoint;
      point: LocalPoint | null;
    };

// Совпадение точек после перепроекции бэкендом (UTM → WGS84) и нашей проекции — сантиметры.
// Столько же недобирает хорда буфера shapely: посадка вплотную к зоне стоит ближе нормы на
// миллиметры (../backend/greenplan/zoning/engine.py:127).
export const TOLERANCE_M = 0.02;
// Ячейка индекса границы: много больше допуска и мельче типичного отрезка.
const BASE_INDEX_CELL_M = 1;
// Для расстояния до границы — крупнее: запрос смотрит ячейки в радиусе до зоны, а не соседние.
const BASE_DISTANCE_CELL_M = 5;
// Ячейка индекса зоны: запрос в радиусе порога отбора смотрит несколько десятков ячеек.
const ZONE_INDEX_CELL_M = 5;

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
  const indexes = new Map<number, PolygonIndex>();
  return {
    zones,
    baseArea,
    lawn,
    onBaseBoundary: nearBase === null ? null : (point: LocalPoint) => nearBase(point, TOLERANCE_M),
    distanceToBase: baseArea === null ? null : boundaryDistance(baseArea, BASE_DISTANCE_CELL_M),
    zoneIndex: (zone) => {
      const known = indexes.get(zone.index);
      if (known !== undefined) return known;
      const built = polygonIndex(zone.polygons, ZONE_INDEX_CELL_M);
      indexes.set(zone.index, built);
      return built;
    },
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
  index: PolygonIndex,
  // Порог «рядом»: дальше него граница зоны не ищется. Несрезанная часть буфера — если в
  // пороге её нет, перебором всей границы.
  limit: number,
  onBaseBoundary: PreparedZones['onBaseBoundary'],
  // До границы допустимой области, но не дальше limit: дальше точное число не меняет вывода.
  distanceToBase: (limit: number) => number,
): ZoneCheck | null {
  // Отбор по охвату грубый: у большой зоны он накрывает весь участок. Граница дальше порога —
  // зона не рядом, если посадка не стоит внутри неё.
  const anyEdge = index.nearest(planting, limit);
  if (anyEdge === null) return index.contains(planting) ? { kind: 'inside', zone } : null;
  // Миллиметры внутри — округление координат при экспорте, а не нарушение: на «Олимпийском»
  // одна посадка из 7 784 стоит в 2 мм за кромкой зоны.
  if (anyEdge.distance > TOLERANCE_M && index.contains(planting)) {
    return { kind: 'inside', zone };
  }

  const skip = onBaseBoundary === null ? null : cutEdge(onBaseBoundary);
  const buffered =
    skip === null
      ? null
      : (index.nearest(planting, limit, skip) ?? nearestOnBoundary(planting, zone.polygons, skip));
  if (buffered === null || distanceToBase(buffered.distance) + TOLERANCE_M < buffered.distance) {
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

type ZoneCheck = Exclude<PlantingCheck, { kind: 'object' }>;

const marginOf = (check: ZoneCheck) => (check.kind === 'inside' ? -Infinity : check.margin);

// Ограничения рядом с посадкой — самое напряжённое сверху.
export function checksForPlanting(
  planting: LocalPoint,
  plantType: PlantType,
  { zones, baseArea, onBaseBoundary, distanceToBase: toBase, zoneIndex, threshold }: PreparedZones,
): ZoneCheck[] {
  const nearby = zones.filter(
    ({ properties, bounds }) =>
      properties.plant_type === plantType &&
      distanceToBounds(planting, bounds) <= threshold[plantType],
  );
  if (nearby.length === 0) return [];
  // Граница допустимой области на крупном участке — десятки тысяч вершин: расстояние до неё
  // ищется по индексу и только в пределах, которые нужны сравнению в checkZone.
  const insideBase = baseArea !== null && isInside(planting, baseArea);
  const distanceToBase = (limit: number) =>
    insideBase && toBase !== null ? toBase(planting, limit) : 0;
  return nearby
    .flatMap((zone) => {
      const check = checkZone(
        planting,
        zone,
        zoneIndex(zone),
        threshold[plantType],
        onBaseBoundary,
        distanceToBase,
      );
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

// Площадь, где посадка этого типа разрешена, м²; null — разрешённой области в данных нет.
export const allowedArea = ({ allowed }: PreparedZones, plantType: PlantType): number | null => {
  const polygons = allowed[plantType];
  return polygons === undefined ? null : area(polygons);
};

// Площадь газона, м²; null — газона в данных нет.
export const lawnArea = ({ lawn }: PreparedZones): number | null =>
  lawn === null ? null : area(lawn);

export type LawnSummary = {
  area: number;
  // Газон в границах участка (base_area): только там бэкенд строит зоны и сажает
  // (../backend/greenplan/zoning/engine.py:104-115). null — граница не найдена, и base_area
  // совпадает со всем газоном (engine.py:110).
  siteArea: number | null;
  // Посадки, чей ствол на газоне.
  trees: number;
  shrubs: number;
  // Доля газона в границах участка под зонами запрета для типа посадки, от 0 до 1.
  prohibitedShare: Record<PlantType, number>;
};

// Сводка по газону — по данным, которые уже есть на фронте: газон, допустимая область
// и разрешённая область из /zones, точки /planting. null — газона в данных нет.
export function lawnSummary(
  prepared: PreparedZones,
  planting: readonly { point: LocalPoint; plantType: PlantType }[],
  usedSiteBoundary: boolean,
): LawnSummary | null {
  const { lawn, baseArea } = prepared;
  if (lawn === null) return null;
  const total = area(lawn);
  const siteArea = usedSiteBoundary && baseArea !== null ? area(baseArea) : null;
  const base = siteArea ?? total;
  const onLawn = planting.filter(({ point }) => isInside(point, lawn));
  const share = (plantType: PlantType) =>
    base === 0 ? 0 : prohibitedArea(prepared, plantType) / base;
  return {
    area: total,
    siteArea,
    trees: onLawn.filter(({ plantType }) => plantType === 'tree').length,
    shrubs: onLawn.filter(({ plantType }) => plantType === 'shrub').length,
    prohibitedShare: { tree: share('tree'), shrub: share('shrub') },
  };
}

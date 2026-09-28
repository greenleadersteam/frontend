import type {
  ObstaclesFeatureCollection,
  PlantingFeatureCollection,
  ZonesFeatureCollection,
} from '@/entities/project';
import { buildContour, type Contour } from '@/shared/lib/contour';

// Откуда контур проекта: граница участка из результата, внешний контур газона, охват посадок;
// у проекта, упавшего на геопривязке, — граница участка из объектов подосновы или файл
// пользователя. У файла — причина, по которой подоснова контура не дала.
export type ContourOrigin =
  | 'boundary'
  | 'lawn'
  | 'plantings'
  | 'obstacles'
  | 'fileNoObstacles'
  | 'fileObstaclesFailed'
  | 'fileMissing'
  | 'fileOpen'
  | 'fileInvalid';

type FileOrigin = Extract<ContourOrigin, `file${string}`>;

// Почему подоснова контура не дала — одной фразой; на карте под заголовком «Загрузите границу
// участка…» идёт только она.
export const FILE_REASON: Record<FileOrigin, string> = {
  fileNoObstacles: 'Сервер не отдаёт объекты подосновы.',
  fileObstaclesFailed: 'Объекты подосновы не загрузились.',
  fileMissing: 'Границы участка в подоснове не нашлось.',
  fileOpen: 'Граница участка в подоснове начерчена незамкнутыми отрезками.',
  fileInvalid: 'Границу участка из подосновы не удалось построить.',
};

const FILE_REQUEST =
  'Загрузите границу участка файлом GeoJSON — в координатах чертежа, в метрах, как DXF.';

export const CONTOUR_ORIGIN_TEXT: Record<ContourOrigin, string> = {
  boundary: 'Граница участка из чертежа',
  lawn: 'Граница участка не найдена — показан внешний контур газона',
  plantings: 'Граница участка не найдена — показан охват посадок',
  obstacles: 'Граница участка из подосновы',
  fileNoObstacles: `${FILE_REASON.fileNoObstacles} ${FILE_REQUEST}`,
  fileObstaclesFailed: `${FILE_REASON.fileObstaclesFailed} ${FILE_REQUEST}`,
  fileMissing: `${FILE_REASON.fileMissing} ${FILE_REQUEST}`,
  fileOpen: `${FILE_REASON.fileOpen} ${FILE_REQUEST}`,
  fileInvalid: `${FILE_REASON.fileInvalid} ${FILE_REQUEST}`,
};

export const isFileOrigin = (origin: ContourOrigin): origin is FileOrigin =>
  Object.hasOwn(FILE_REASON, origin);

// Запас вокруг охвата посадок: крона дерева и немного газона вокруг, м.
export const PLANTINGS_MARGIN_M = 5;
// Окружность запаса — многоугольником: на 5 м он отходит от окружности на 0,1 м.
const MARGIN_STEPS = 16;

type Point = [number, number];

const cross = (o: Point, a: Point, b: Point) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

// Выпуклая оболочка (монотонная цепочка Эндрю), против часовой стрелки.
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const half = (list: Point[]) => {
    const chain: Point[] = [];
    for (const point of list) {
      while (chain.length >= 2) {
        const [a, b] = [chain.at(-2), chain.at(-1)];
        if (a === undefined || b === undefined || cross(a, b, point) > 0) break;
        chain.pop();
      }
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

// Охват посадок с запасом: оболочка точек, каждая из которых размножена по окружности запаса, —
// это и есть оболочка, раздутая на запас.
function plantingsOutline(planting: PlantingFeatureCollection): Point[] | null {
  const spread = planting.features.flatMap(
    ({
      geometry: {
        coordinates: [x, y],
      },
    }) =>
      x === undefined || y === undefined
        ? []
        : Array.from({ length: MARGIN_STEPS }, (_, step): Point => {
            const angle = (2 * Math.PI * step) / MARGIN_STEPS;
            return [
              x + PLANTINGS_MARGIN_M * Math.cos(angle),
              y + PLANTINGS_MARGIN_M * Math.sin(angle),
            ];
          }),
  );
  const hull = convexHull(spread);
  return hull.length < 3 ? null : hull;
}

// Контур проекта для модуля геопривязки — в метрах чертежа, как данные проекта без привязки:
// граница участка, если сервис её использовал; иначе внешний контур газона (lawn_raw — уже
// объединение, ../backend/greenplan/zoning/engine.py:93, поэтому его внешние кольца и есть контур
// объединения); иначе охват посадок с запасом. null — не из чего строить.
export function projectContour(
  zones: ZonesFeatureCollection,
  planting: PlantingFeatureCollection,
  name: string,
): { contour: Contour; origin: ContourOrigin } | null {
  const zone = (type: 'site_boundary' | 'lawn_raw') =>
    zones.features.find(({ properties }) => properties.zone_type === type)?.geometry;

  const boundary = zones.metadata.used_site_boundary ? zone('site_boundary') : undefined;
  if (boundary !== undefined) {
    const built = buildContour(boundary, name);
    if (built.ok) return { contour: built.contour, origin: 'boundary' };
  }

  const lawn = zone('lawn_raw');
  if (lawn !== undefined) {
    const outer =
      lawn.type === 'Polygon'
        ? [lawn.coordinates.slice(0, 1)]
        : lawn.coordinates.map((polygon) => polygon.slice(0, 1));
    const built = buildContour({ type: 'MultiPolygon', coordinates: outer }, name);
    if (built.ok) return { contour: built.contour, origin: 'lawn' };
  }

  const outline = plantingsOutline(planting);
  if (outline === null) return null;
  const built = buildContour({ type: 'Polygon', coordinates: [outline] }, name);
  return built.ok ? { contour: built.contour, origin: 'plantings' } : null;
}

type ObstacleGeometry = ObstaclesFeatureCollection['features'][number]['geometry'];

// Кольца границы участка: полигоны и замкнутые линии. Незамкнутую линию (граница, начерченная
// отрезками) сервер сшивает сам (../backend/greenplan/zoning/topology.py); здесь её не угадываем.
function boundaryRings(geometry: ObstacleGeometry): number[][][][] {
  const closed = (line: number[][]) => {
    const [first, last] = [line[0], line.at(-1)];
    return (
      line.length >= 4 &&
      first !== undefined &&
      last !== undefined &&
      first[0] === last[0] &&
      first[1] === last[1]
    );
  };
  switch (geometry.type) {
    case 'Polygon':
      return [geometry.coordinates];
    case 'MultiPolygon':
      return geometry.coordinates;
    case 'LineString':
      return closed(geometry.coordinates) ? [[geometry.coordinates]] : [];
    case 'MultiLineString':
      return geometry.coordinates.filter(closed).map((line) => [line]);
    case 'Point':
      return [];
    default: {
      const unexpected: never = geometry;
      return unexpected;
    }
  }
}

// Контур проекта, упавшего на геопривязке: граница участка (категория site_boundary, у сервера —
// граница работ) из объектов разобранной подосновы, в метрах чертежа. Без контура — причина:
// границы нет или она начерчена незамкнутыми отрезками.
export function obstaclesContour(
  obstacles: ObstaclesFeatureCollection,
  name: string,
):
  | { kind: 'contour'; contour: Contour }
  | { kind: 'missing' }
  | { kind: 'open' }
  | { kind: 'invalid' } {
  const boundary = obstacles.features.filter(
    ({ properties }) => properties.category === 'site_boundary',
  );
  if (boundary.length === 0) return { kind: 'missing' };
  const polygons = boundary.flatMap(({ geometry }) => boundaryRings(geometry));
  if (polygons.length === 0) return { kind: 'open' };
  // Кольца замкнуты, но контур не собрался (например, в кольце меньше трёх вершин).
  const built = buildContour({ type: 'MultiPolygon', coordinates: polygons }, name);
  return built.ok ? { kind: 'contour', contour: built.contour } : { kind: 'invalid' };
}

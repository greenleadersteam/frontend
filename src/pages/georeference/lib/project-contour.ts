import type { PlantingFeatureCollection, ZonesFeatureCollection } from '@/entities/project';
import { buildContour, type Contour } from '@/shared/lib/contour';

// Откуда контур проекта: граница участка из чертежа, внешний контур газона или охват посадок.
export type ContourOrigin = 'boundary' | 'lawn' | 'plantings';

export const CONTOUR_ORIGIN_TEXT: Record<ContourOrigin, string> = {
  boundary: 'Граница участка из чертежа',
  lawn: 'Граница участка не найдена — показан внешний контур газона',
  plantings: 'Граница участка не найдена — показан охват посадок',
};

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

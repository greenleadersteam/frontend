// Точка на локальной метрической плоскости: x — на восток, y — на север.
export type LocalPoint = readonly [x: number, y: number];

// Полигон в локальных метрах: первое кольцо — внешнее, остальные — дыры. Кольца замкнуты
// (последняя вершина повторяет первую), как в GeoJSON.
export type LocalPolygon = readonly (readonly LocalPoint[])[];

export type Nearest = { point: LocalPoint; distance: number };

export function nearestOnSegment(p: LocalPoint, a: LocalPoint, b: LocalPoint): Nearest {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const point: LocalPoint = [ax + t * dx, ay + t * dy];
  return { point, distance: Math.hypot(px - point[0], py - point[1]) };
}

function* ringSegments(ring: readonly LocalPoint[]): Generator<[LocalPoint, LocalPoint]> {
  let previous: LocalPoint | null = null;
  for (const point of ring) {
    if (previous !== null) yield [previous, point];
    previous = point;
  }
}

// Правило чёт-нечет по всем кольцам: точка в дыре лежит вне полигона. Точка на границе
// считается снаружи — посадка на самой кромке зоны норму не нарушает.
export function isInside([px, py]: LocalPoint, polygons: readonly LocalPolygon[]): boolean {
  return polygons.some((polygon) => {
    let inside = false;
    for (const ring of polygon) {
      let previous: LocalPoint | null = null;
      for (const point of ring) {
        if (previous !== null) {
          const [ax, ay] = previous;
          const [bx, by] = point;
          if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) {
            inside = !inside;
          }
        }
        previous = point;
      }
    }
    return inside;
  });
}

// Ближайшая точка границы. skip исключает отрезки, по которым расстояние мерить нельзя
// (например, срез зоны по краю участка); он дорогой, поэтому зовётся только для отрезков,
// которые ближе уже найденного. У зон крупного участка сотни тысяч вершин, поэтому цикл
// считает квадрат расстояния без промежуточных объектов.
export function nearestOnBoundary(
  [px, py]: LocalPoint,
  polygons: readonly LocalPolygon[],
  skip?: (a: LocalPoint, b: LocalPoint) => boolean,
): Nearest | null {
  let bestSquared = Infinity;
  let best: LocalPoint | null = null;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      let a: LocalPoint | null = null;
      for (const b of ring) {
        if (a === null) {
          a = b;
          continue;
        }
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const lengthSquared = dx * dx + dy * dy;
        const t =
          lengthSquared === 0
            ? 0
            : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / lengthSquared));
        const x = a[0] + t * dx;
        const y = a[1] + t * dy;
        const squared = (px - x) ** 2 + (py - y) ** 2;
        if (squared < bestSquared && skip?.(a, b) !== true) {
          bestSquared = squared;
          best = [x, y];
        }
        a = b;
      }
    }
  }
  return best === null ? null : { point: best, distance: Math.sqrt(bestSquared) };
}

// Лежит ли точка у границы: сетка из ячеек по cellSize метров, в ячейку попадают отрезки,
// которые через неё проходят. Отрезок заносится точками с шагом в ячейку, а запрос смотрит
// ячейку точки и восемь соседних: при tolerance меньше половины ячейки так не теряется ни
// один отрезок. Строится один раз; запрос перебирает несколько отрезков вместо всей границы.
export function boundaryIndex(
  polygons: readonly LocalPolygon[],
  cellSize: number,
): (point: LocalPoint, tolerance: number) => boolean {
  const cells = new Map<string, [LocalPoint, LocalPoint][]>();
  const keyOf = (x: number, y: number, dx = 0, dy = 0) =>
    `${String(Math.floor(x / cellSize) + dx)}:${String(Math.floor(y / cellSize) + dy)}`;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [a, b] of ringSegments(ring)) {
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / cellSize));
        const keys = new Set<string>();
        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps;
          keys.add(keyOf(a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])));
        }
        for (const key of keys) {
          const segments = cells.get(key);
          if (segments === undefined) cells.set(key, [[a, b]]);
          else segments.push([a, b]);
        }
      }
    }
  }
  return (point, tolerance) => {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const segments = cells.get(keyOf(point[0], point[1], dx, dy)) ?? [];
        if (segments.some(([a, b]) => nearestOnSegment(point, a, b).distance <= tolerance)) {
          return true;
        }
      }
    }
    return false;
  };
}

// Площадь по формуле Гаусса: внешнее кольцо минус дыры.
export function area(polygons: readonly LocalPolygon[]): number {
  const ringArea = (ring: readonly LocalPoint[]) => {
    let sum = 0;
    for (const [[ax, ay], [bx, by]] of ringSegments(ring)) sum += ax * by - bx * ay;
    return Math.abs(sum) / 2;
  };
  let total = 0;
  for (const polygon of polygons) {
    polygon.forEach((ring, index) => {
      total += index === 0 ? ringArea(ring) : -ringArea(ring);
    });
  }
  return total;
}

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

type Segment = [LocalPoint, LocalPoint];

// Сетка из ячеек по cellSize метров: в ячейку попадают отрезки границы, которые через неё
// проходят. Отрезок заносится точками с шагом в ячейку — любая его точка не дальше половины
// ячейки от занесённой, поэтому запросу хватает соседних ячеек. Один отрезок — один объект во
// всех ячейках: так запрос отбрасывает повторы.
function segmentGrid(polygons: readonly LocalPolygon[], cellSize: number) {
  const cells = new Map<string, Segment[]>();
  const keyOf = (x: number, y: number, dx = 0, dy = 0) =>
    `${String(Math.floor(x / cellSize) + dx)}:${String(Math.floor(y / cellSize) + dy)}`;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const segment of ringSegments(ring)) {
        const [a, b] = segment;
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / cellSize));
        const keys = new Set<string>();
        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps;
          keys.add(keyOf(a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])));
        }
        for (const key of keys) {
          const segments = cells.get(key);
          if (segments === undefined) cells.set(key, [segment]);
          else segments.push(segment);
        }
      }
    }
  }
  return { cells, keyOf };
}

// Лежит ли точка у границы. Запрос смотрит ячейку точки и восемь соседних: при tolerance меньше
// половины ячейки так не теряется ни один отрезок. Строится один раз; запрос перебирает
// несколько отрезков вместо всей границы.
export function boundaryIndex(
  polygons: readonly LocalPolygon[],
  cellSize: number,
): (point: LocalPoint, tolerance: number) => boolean {
  const { cells, keyOf } = segmentGrid(polygons, cellSize);
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

// Расстояние от точки до границы, но не больше limit: дальше него точный ответ не нужен, и
// запрос смотрит только ячейки в радиусе limit, а не всю границу. Возвращает limit, если
// ближе ничего нет.
export function boundaryDistance(
  polygons: readonly LocalPolygon[],
  cellSize: number,
): (point: LocalPoint, limit: number) => number {
  const { cells, keyOf } = segmentGrid(polygons, cellSize);
  return (point, limit) => {
    const reach = Math.ceil(limit / cellSize);
    let best = limit;
    const seen = new Set<Segment>();
    for (let dx = -reach; dx <= reach; dx += 1) {
      for (let dy = -reach; dy <= reach; dy += 1) {
        for (const segment of cells.get(keyOf(point[0], point[1], dx, dy)) ?? []) {
          if (seen.has(segment)) continue;
          seen.add(segment);
          best = Math.min(best, nearestOnSegment(point, segment[0], segment[1]).distance);
        }
      }
    }
    return best;
  };
}

export type PolygonIndex = {
  // Ближайшая точка границы не дальше limit; null — ближе ничего нет. skip — как у
  // nearestOnBoundary.
  nearest: (
    point: LocalPoint,
    limit: number,
    skip?: (a: LocalPoint, b: LocalPoint) => boolean,
  ) => Nearest | null;
  // То же, что isInside, для полигонов без взаимных наложений.
  contains: (point: LocalPoint) => boolean;
};

// Индекс границы полигонов для частых запросов у крупного участка: у зон «Олимпийского» —
// сотни тысяч вершин, и перебор всей границы для каждой из тысяч посадок занимал минуты.
// Ближайшая точка ищется в ячейках радиуса limit; «внутри» — лучом вправо по строке ячеек
// точки и двум соседним (отрезок, пересекающий луч, занесён в одну из них). Ответы те же,
// что у перебора: каждый отрезок проверяется точной формулой.
export function polygonIndex(polygons: readonly LocalPolygon[], cellSize: number): PolygonIndex {
  const { cells, keyOf } = segmentGrid(polygons, cellSize);
  let maxX = Number.NEGATIVE_INFINITY;
  for (const polygon of polygons) {
    for (const ring of polygon) for (const [x] of ring) maxX = Math.max(maxX, x);
  }
  const columnsTo = (x: number) => Math.floor(maxX / cellSize) - Math.floor(x / cellSize) + 1;

  return {
    nearest: ([px, py], limit, skip) => {
      const reach = Math.ceil(limit / cellSize) + 1;
      let bestSquared = limit * limit;
      let best: LocalPoint | null = null;
      const seen = new Set<Segment>();
      for (let dx = -reach; dx <= reach; dx += 1) {
        for (let dy = -reach; dy <= reach; dy += 1) {
          for (const segment of cells.get(keyOf(px, py, dx, dy)) ?? []) {
            if (seen.has(segment)) continue;
            seen.add(segment);
            const [a, b] = segment;
            const nearest = nearestOnSegment([px, py], a, b);
            if (nearest.distance ** 2 <= bestSquared && skip?.(a, b) !== true) {
              bestSquared = nearest.distance ** 2;
              best = nearest.point;
            }
          }
        }
      }
      return best === null ? null : { point: best, distance: Math.sqrt(bestSquared) };
    },
    contains: ([px, py]) => {
      let inside = false;
      const seen = new Set<Segment>();
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= columnsTo(px); dx += 1) {
          for (const segment of cells.get(keyOf(px, py, dx, dy)) ?? []) {
            if (seen.has(segment)) continue;
            seen.add(segment);
            const [[ax, ay], [bx, by]] = segment;
            if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) {
              inside = !inside;
            }
          }
        }
      }
      return inside;
    },
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

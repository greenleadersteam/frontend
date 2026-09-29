// Ракурсы 3D-сцены по охвату посадок: камера не задаётся руками, а считается из плана.

export type View = 'overview' | 'along' | 'pedestrian';

type Bounds = [[number, number], [number, number]];

type ViewCamera =
  // Вписать охват с поворотом и наклоном.
  | { kind: 'fit'; bounds: Bounds; bearing: number; pitch: number }
  // Встать над точкой на заданном масштабе.
  | { kind: 'point'; center: [number, number]; zoom: number; bearing: number; pitch: number };

const OVERVIEW_PITCH = 60;
const PEDESTRIAN_PITCH = 75;
// Обзор — сверху-сбоку, чуть повёрнут, чтобы высота читалась и у построек вдоль улицы.
const OVERVIEW_BEARING = -20;
// Сетка поиска самого плотного места, м; масштаб пешеходного ракурса — улица в несколько домов.
const DENSITY_CELL_M = 20;
const PEDESTRIAN_ZOOM = 19;
const METERS_PER_DEGREE = 111_320;

type Point = readonly [number, number];

function boundsOf(points: readonly Point[]): Bounds {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

// Направление длинной оси охвата — главная ось облака точек в метрах, как азимут карты.
export function longAxisBearing(points: readonly Point[]): number {
  const [[, south], [, north]] = boundsOf(points);
  const scale = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const xs = points.map(([x]) => x * scale);
  const ys = points.map(([, y]) => y);
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const [mx, my] = [mean(xs), mean(ys)];
  let [sxx, syy, sxy] = [0, 0, 0];
  xs.forEach((x, index) => {
    const dx = x - mx;
    const dy = (ys[index] ?? my) - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  });
  // Угол главной оси от востока против часовой; азимут карты — от севера по часовой.
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return 90 - (angle * 180) / Math.PI;
}

// Центр клетки сетки, где посадок больше всего.
export function densestPoint(points: readonly Point[]): [number, number] {
  const [[west, south]] = boundsOf(points);
  const scale = Math.cos((south * Math.PI) / 180);
  const cellLon = DENSITY_CELL_M / (METERS_PER_DEGREE * scale);
  const cellLat = DENSITY_CELL_M / METERS_PER_DEGREE;
  const counts = new Map<string, number>();
  let best: { key: string; count: number } = { key: '0|0', count: 0 };
  for (const [x, y] of points) {
    const key = `${String(Math.floor((x - west) / cellLon))}|${String(Math.floor((y - south) / cellLat))}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count > best.count) best = { key, count };
  }
  const [column = 0, row = 0] = best.key.split('|').map(Number);
  return [west + (column + 0.5) * cellLon, south + (row + 0.5) * cellLat];
}

export function viewCamera(view: View, points: readonly Point[]): ViewCamera {
  switch (view) {
    case 'overview':
      return {
        kind: 'fit',
        bounds: boundsOf(points),
        bearing: OVERVIEW_BEARING,
        pitch: OVERVIEW_PITCH,
      };
    case 'along':
      return {
        kind: 'fit',
        bounds: boundsOf(points),
        bearing: longAxisBearing(points),
        pitch: OVERVIEW_PITCH,
      };
    case 'pedestrian':
      return {
        kind: 'point',
        center: densestPoint(points),
        zoom: PEDESTRIAN_ZOOM,
        bearing: longAxisBearing(points),
        pitch: PEDESTRIAN_PITCH,
      };
    default: {
      const unexpected: never = view;
      return unexpected;
    }
  }
}

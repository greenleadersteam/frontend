import type { Contour } from '../contour';
import type { FitResult, LatLon, LocalPoint } from '../geodesy';
import { enuFrame, fitSimilarity } from '../geodesy';
import type { Placement } from './placement';
import { normalizeAngle, vertexLatLon } from './placement';

// Опорные точки: пары «точка контура ↔ точка на карте». Перенесено из прототипа
// ../geojson/js/gcp.js без изменений логики и допусков.
//
// Две пары задают подобие точно, поэтому с двух пар положение контура считается подгонкой, а не
// руками. Невязки меряются в метрах на местности: пиксели ничего не говорят о качестве привязки.
//
// Контрольные точки в подгонке не участвуют. При малом числе точек это единственный честный
// способ увидеть настоящую ошибку: на учтённых точках невязка занижена по построению.

export type SnapKind = 'vertex' | 'edge';

export type GcpPair = LocalPoint &
  LatLon & {
    id: string;
    // Номер точки для оператора: не меняется при удалении соседних.
    n: number;
    kind: SnapKind;
    enabled: boolean;
    control: boolean;
  };

// Допуск: 0,3 мм в масштабе работ. Для 1:500 это 0,15 м.
export const WORK_SCALES = [500, 1000, 2000, 5000] as const;
export type WorkScale = (typeof WORK_SCALES)[number];
export const TOLERANCE_MM = 0.3;

export const tolerance = (denominator: number): number => (TOLERANCE_MM / 1000) * denominator;

export const usedPairs = (list: readonly GcpPair[]): GcpPair[] =>
  list.filter((p) => p.enabled && !p.control);

export const controlPairs = (list: readonly GcpPair[]): GcpPair[] =>
  list.filter((p) => p.enabled && p.control);

// С двух учтённых пар положение задаётся точками, а не руками.
export const isLocked = (list: readonly GcpPair[]): boolean => usedPairs(list).length >= 2;

export const SNAP_PX = 12;

export type Snap = LocalPoint & {
  kind: SnapKind;
  distance: number;
  polygon: number;
  ring: number;
  index: number;
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// project отдаёт экранную точку вершины; сравнение идёт в пикселях, потому что притяжение —
// про то, что видит глаз.
export function snapToContour(
  source: Contour,
  project: (point: LocalPoint) => LocalPoint,
  point: LocalPoint,
): Snap | null {
  let bestVertex: Snap | null = null;
  let bestEdge: Snap | null = null;

  for (const [polygon, rings] of source.polygons.entries()) {
    for (const [ringIndex, ring] of rings.entries()) {
      for (const [index, a] of ring.entries()) {
        // Кольцо хранится без замыкающей вершины: за последней идёт первая.
        const b = ring[(index + 1) % ring.length] ?? a;
        const pa = project(a);
        const pb = project(b);

        const dv = Math.hypot(pa.x - point.x, pa.y - point.y);
        if (bestVertex === null || dv < bestVertex.distance) {
          bestVertex = {
            x: a.x,
            y: a.y,
            kind: 'vertex',
            distance: dv,
            polygon,
            ring: ringIndex,
            index,
          };
        }

        const vx = pb.x - pa.x;
        const vy = pb.y - pa.y;
        const len2 = vx * vx + vy * vy;
        let t = len2 ? ((point.x - pa.x) * vx + (point.y - pa.y) * vy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const de = Math.hypot(pa.x + vx * t - point.x, pa.y + vy * t - point.y);
        if (bestEdge === null || de < bestEdge.distance) {
          bestEdge = {
            x: lerp(a.x, b.x, t),
            y: lerp(a.y, b.y, t),
            kind: 'edge',
            distance: de,
            polygon,
            ring: ringIndex,
            index,
          };
        }
      }
    }
  }

  if (bestVertex === null) return null;
  return bestVertex.distance <= SNAP_PX ? bestVertex : bestEdge;
}

function centroidLatLon(list: readonly GcpPair[]): LatLon {
  let lat = 0;
  let lon = 0;
  for (const p of list) {
    lat += p.lat;
    lon += p.lon;
  }
  return { lat: lat / list.length, lon: lon / list.length };
}

export type Solution = {
  anchor: LatLon;
  rotation: number;
  scale: number;
  fit: FitResult;
  origin: LatLon;
  count: number;
};

const SOLVE_PASSES = 3;

// Параметры привязки по учтённым парам.
//
// Подгонка идёт в локальной плоскости ENU, и плоскость эта обязана совпасть с той, в которой потом
// строится контур, — то есть иметь начало в опорной точке. Начало неизвестно до решения, поэтому
// первый проход считается от центра тяжести целевых точек, а следующие — от найденной опорной
// точки. Без этих итераций две пары дают невязку около двух сантиметров вместо нуля: ровно
// на столько расходятся две касательные плоскости на площадке в километр.
export function solve(source: Contour, gcp: readonly GcpPair[]): Solution | null {
  const list = usedPairs(gcp);
  if (list.length < 2) return null;

  const c = source.center;
  const src = list.map((p) => ({ x: p.x, y: p.y }));
  let origin = centroidLatLon(list);
  let solution: Solution | null = null;

  for (let pass = 0; pass < SOLVE_PASSES; pass += 1) {
    const frame = enuFrame(origin);
    const dst = list.map((p) => {
      const { e, n } = frame.toEnu({ lat: p.lat, lon: p.lon, h: 0 });
      return { x: e, y: n };
    });
    const fit = fitSimilarity(src, dst);
    if (fit === null) return null;

    // Опорная точка контура — центр габарита, прогнанный через найденное подобие.
    const e = fit.a * c.x - fit.b * c.y + fit.tx;
    const n = fit.b * c.x + fit.a * c.y + fit.ty;
    const g = frame.toGeodetic({ e, n, u: 0 });
    origin = { lat: g.lat, lon: g.lon };
    solution = {
      anchor: origin,
      rotation: normalizeAngle(fit.rotationDeg),
      scale: fit.scale,
      fit,
      origin,
      count: list.length,
    };
  }

  return solution;
}

export type Residual = {
  pair: GcpPair;
  computed: LatLon;
  dE: number;
  dN: number;
  dS: number;
  used: boolean;
  control: boolean;
};

// Вектор от фактического положения точки (куда её поставил оператор) к расчётному (куда её кладёт
// модель). Считается для всех пар, включая выключенные и контрольные.
export function residuals(placement: Placement, gcp: readonly GcpPair[]): Residual[] {
  return gcp.map((pair) => {
    const computed = vertexLatLon(pair, placement);
    const d = enuFrame({ lat: pair.lat, lon: pair.lon }).toEnu({ ...computed, h: 0 });
    return {
      pair,
      computed,
      dE: d.e,
      dN: d.n,
      dS: Math.hypot(d.e, d.n),
      used: pair.enabled && !pair.control,
      control: pair.enabled && pair.control,
    };
  });
}

function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? NaN;
  return sorted.length % 2 ? upper : ((sorted[mid - 1] ?? NaN) + upper) / 2;
}

function rmsOf(rows: readonly Residual[]): number {
  if (rows.length === 0) return NaN;
  let sum = 0;
  for (const r of rows) sum += r.dS * r.dS;
  return Math.sqrt(sum / rows.length);
}

export type Verdict = 'ok' | 'warn' | 'bad' | 'none';

export type GcpStats = {
  rows: Residual[];
  rms: number;
  max: number;
  sigma: number;
  medianResidual: number;
  rmsControl: number;
  usedCount: number;
  controlCount: number;
  disabledCount: number;
  total: number;
  tolerance: number;
  verdict: Verdict;
  // Ровно две учтённые пары дают тождественно нулевую невязку: решение проходит через точки
  // точно, и низкий RMS ничего не значит.
  exact: boolean;
};

export function stats(
  placement: Placement,
  gcp: readonly GcpPair[],
  workScale: WorkScale,
): GcpStats {
  const rows = residuals(placement, gcp);
  const usedRows = rows.filter((r) => r.used);
  const controlRows = rows.filter((r) => r.control);

  const rms = rmsOf(usedRows);
  let max = 0;
  for (const r of usedRows) max = Math.max(max, r.dS);

  // Стандартное отклонение имеет смысл, когда точек хватает: на двух парах невязки тождественно
  // нулевые.
  //
  // Считается оно устойчиво, через медиану абсолютных отклонений: обычная сигма раздувается той
  // самой грубой ошибкой, которую ищем, и выброс маскирует сам себя. Множитель 1,4826 приводит
  // медианную оценку к обычному стандартному отклонению.
  let sigma = NaN;
  if (usedRows.length >= 4) {
    const values = usedRows.map((r) => r.dS);
    const med = median(values);
    sigma = 1.4826 * median(values.map((v) => Math.abs(v - med)));
    if (!(sigma > 0)) {
      const mean = values.reduce((a, v) => a + v, 0) / values.length;
      let acc = 0;
      for (const v of values) acc += (v - mean) * (v - mean);
      sigma = Math.sqrt(acc / (values.length - 1));
    }
  }

  const tol = tolerance(workScale);
  return {
    rows,
    rms,
    max,
    sigma,
    medianResidual: usedRows.length ? median(usedRows.map((r) => r.dS)) : NaN,
    rmsControl: rmsOf(controlRows),
    usedCount: usedRows.length,
    controlCount: controlRows.length,
    disabledCount: rows.length - usedRows.length - controlRows.length,
    total: rows.length,
    tolerance: tol,
    verdict: verdict(rms, tol),
    exact: usedRows.length > 0 && usedRows.length <= 2,
  };
}

// Светофор: зелёный — с запасом, жёлтый — впритык, красный — вне допуска.
export function verdict(rms: number, tol: number): Verdict {
  if (!Number.isFinite(rms) || !Number.isFinite(tol) || tol <= 0) return 'none';
  if (rms <= tol * 0.75) return 'ok';
  if (rms <= tol) return 'warn';
  return 'bad';
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  ok: 'в допуске',
  warn: 'на границе допуска',
  bad: 'вне допуска',
  none: 'нет данных',
};

// Строка с выбросом: невязка больше трёх стандартных отклонений.
//
// К этому правилу добавлены два порога, иначе оно бесполезно на малом числе точек: на чистых
// данных сигма падает до микрометров и красной становится половина таблицы, а одна грубая ошибка
// перекашивает невязки всех точек сразу и красит таблицу целиком. Поэтому выброс обязан вдвое
// превышать медианную невязку и быть не меньше пятой части допуска — тогда подсвечивается именно
// виновник.
export function isOutlier(row: Residual, summary: GcpStats): boolean {
  if (!row.used || !Number.isFinite(summary.sigma) || summary.sigma <= 0) return false;
  if (row.dS <= 3 * summary.sigma) return false;
  if (Number.isFinite(summary.medianResidual) && row.dS < 2 * summary.medianResidual) {
    return false;
  }
  return row.dS >= summary.tolerance * 0.2;
}

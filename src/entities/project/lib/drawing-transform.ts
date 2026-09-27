import { WGS84 } from '@/shared/lib/geodesy';

import type { ExplanationEntry } from '../api/project-result-api';

// Точка плана в данных результата: [lon, lat] при геопривязке, [x, y] чертежа без неё.
type DataPoint = readonly number[];

// Как получить координаты чертежа для точки плана.
export type DrawingTransform =
  // Без геопривязки данные уже в метрах чертежа.
  | { kind: 'identity' }
  | {
      kind: 'fitted';
      toDrawing: (point: DataPoint) => [number, number];
      rms: number;
      pairs: number;
    }
  // Подгонка не сошлась: сервер применил не подобие, и точка чертежа была бы неверной.
  | { kind: 'mismatch'; rms: number }
  // Пар «точка плана — точка чертежа» меньше трёх: по двум подобие решается точно, RMS всегда
  // ноль, и проверить подгонку нечем.
  | { kind: 'insufficient' };

// Больше 1 см — сервер привязал чертёж не поворотом, сдвигом и масштабом. В /explanation
// координаты чертежа округлены до сантиметра (../backend/greenplan/explain/builder.py:28-29),
// поэтому точной подгонке остаётся около 0,4 см.
export const DRAWING_FIT_LIMIT_M = 0.01;

// Четыре параметра подобия: третья пара даёт избыток, по которому видно, сошлась ли подгонка.
const MIN_PAIRS = 3;

const { A: SEMI_MAJOR, E2 } = WGS84;
// Второй эксцентриситет в квадрате.
const EP2 = E2 / (1 - E2);

// Длина дуги меридиана от экватора (Snyder, «Map projections — a working manual», 3-21).
function meridionalArc(phi: number): number {
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  return (
    SEMI_MAJOR *
    ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi))
  );
}

// Поперечная проекция Меркатора с центральным меридианом участка (Snyder, 8-9, 8-10), метры.
// Сервер ведёт расчёт в UTM (../backend/greenplan/georeference/transform.py), а она, как и
// эта проекция, конформна: на участке в километр они совпадают с точностью до поворота,
// сдвига и постоянного масштаба — ровно того, что снимает подгонка подобия. В равнопромежуточной
// проекции сходимость меридианов дала бы на таком участке сантиметры ошибки.
function transverseMercator([lon = 0, lat = 0]: DataPoint, centralLon: number): [number, number] {
  const phi = (lat * Math.PI) / 180;
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const n = SEMI_MAJOR / Math.sqrt(1 - E2 * sin * sin);
  const t = (sin / cos) ** 2;
  const c = EP2 * cos * cos;
  const a = (((lon - centralLon) * Math.PI) / 180) * cos;
  const x =
    n *
    (a + ((1 - t + c) * a ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5) / 120);
  const y =
    meridionalArc(phi) +
    n *
      (sin / cos) *
      ((a * a) / 2 +
        ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24 +
        ((61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6) / 720);
  return [x, y];
}

type Pair = { local: [number, number]; drawing: [number, number] };

// Подобие (поворот, масштаб, сдвиг — 4 параметра) методом наименьших квадратов:
// X = a·u − b·v + tx, Y = b·u + a·v + ty.
function fitSimilarity(pairs: Pair[]) {
  const mean = (pick: (pair: Pair) => number) =>
    pairs.reduce((sum, pair) => sum + pick(pair), 0) / pairs.length;
  const [mu, mv] = [mean(({ local }) => local[0]), mean(({ local }) => local[1])];
  const [mx, my] = [mean(({ drawing }) => drawing[0]), mean(({ drawing }) => drawing[1])];
  let norm = 0;
  let sa = 0;
  let sb = 0;
  for (const { local, drawing } of pairs) {
    const [u, v] = [local[0] - mu, local[1] - mv];
    const [x, y] = [drawing[0] - mx, drawing[1] - my];
    norm += u * u + v * v;
    sa += u * x + v * y;
    sb += u * y - v * x;
  }
  if (norm === 0) return null;
  const a = sa / norm;
  const b = sb / norm;
  const apply = ([u, v]: [number, number]): [number, number] => [
    a * (u - mu) - b * (v - mv) + mx,
    b * (u - mu) + a * (v - mv) + my,
  ];
  const squares = pairs.map(({ local, drawing }) => {
    const [x, y] = apply(local);
    return (x - drawing[0]) ** 2 + (y - drawing[1]) ** 2;
  });
  return { apply, rms: Math.sqrt(squares.reduce((sum, value) => sum + value, 0) / pairs.length) };
}

type PlanPlanting = {
  geometry: { coordinates: DataPoint };
  properties: { id: string; origin: 'auto' | 'manual'; moved_from: DataPoint | null };
};

// Точка входа для перевода плана в систему чертежа. Сейчас преобразование восстанавливается
// подгонкой по неизменённым посадкам: у них есть и точка плана (/planting), и точка чертежа
// (/explanation). Когда модуль геопривязки отдаст своё преобразование (проход Г1), здесь оно
// заменит подгонку.
export function drawingTransform(
  plantings: readonly PlanPlanting[],
  entries: ReadonlyMap<string, ExplanationEntry>,
  geographic: boolean,
): DrawingTransform {
  if (!geographic) return { kind: 'identity' };
  const lons = plantings.map(({ geometry }) => geometry.coordinates[0] ?? 0);
  const centralLon = lons.length === 0 ? 0 : (Math.min(...lons) + Math.max(...lons)) / 2;
  const pairs = plantings.flatMap(({ geometry, properties }): Pair[] => {
    if (properties.origin === 'manual' || properties.moved_from !== null) return [];
    const entry = entries.get(properties.id);
    if (entry === undefined) return [];
    return [
      {
        local: transverseMercator(geometry.coordinates, centralLon),
        drawing: [entry.x, entry.y],
      },
    ];
  });
  const fit = pairs.length < MIN_PAIRS ? null : fitSimilarity(pairs);
  if (fit === null) return { kind: 'insufficient' };
  if (fit.rms > DRAWING_FIT_LIMIT_M) return { kind: 'mismatch', rms: fit.rms };
  return {
    kind: 'fitted',
    toDrawing: (point) => fit.apply(transverseMercator(point, centralLon)),
    rms: fit.rms,
    pairs: pairs.length,
  };
}

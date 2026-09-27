import type { Contour } from '../contour';
import type { EnuFrame, LatLon, LocalPoint, PlaneEnu } from '../geodesy';
import { enuFrame, similarity, toRad, vincentyInverse } from '../geodesy';

// Положение контура на эллипсоиде. Перенесено из прототипа ../geojson/js/transform.js без
// изменений логики.
//
// Вершина живёт в двух системах: в местных метрах файла и на эллипсоиде. Путь туда один и тот же
// для отрисовки, выгрузки и измерений: вычесть центр габарита, умножить на масштаб, повернуть
// против часовой, получить ENU и перевести в географические координаты относительно опорной точки.

export type Placement = {
  source: Contour;
  // Куда попадает центр габарита.
  anchor: LatLon;
  // Градусы против часовой стрелки.
  rotation: number;
  // Метров в единице файла.
  scale: number;
};

// Средний радиус Земли — только для оценки погрешности модели.
export const R_MEAN = 6_371_008.8;

export function localToEnu(point: LocalPoint, placement: Placement): PlaneEnu {
  return similarity(point, {
    originX: placement.source.center.x,
    originY: placement.source.center.y,
    rotationDeg: placement.rotation,
    scale: placement.scale,
  });
}

export function enuToLocal({ e, n }: PlaneEnu, placement: Placement): LocalPoint {
  const th = toRad(-placement.rotation);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const x = (e * c - n * s) / placement.scale;
  const y = (e * s + n * c) / placement.scale;
  return { x: x + placement.source.center.x, y: y + placement.source.center.y };
}

// Рамку опорной точки вызывающая сторона считает один раз на весь контур.
export const frameOf = (placement: Placement): EnuFrame => enuFrame(placement.anchor);

export function vertexLatLon(
  point: LocalPoint,
  placement: Placement,
  frame: EnuFrame = frameOf(placement),
): LatLon {
  const { lat, lon } = frame.toGeodetic({ ...localToEnu(point, placement), u: 0 });
  return { lat, lon };
}

export function sizeOnMap({ source, scale }: Pick<Placement, 'source' | 'scale'>): {
  width: number;
  height: number;
  radius: number;
} {
  return {
    width: source.bbox.width * scale,
    height: source.bbox.height * scale,
    radius: source.radius * scale,
  };
}

// Ручка вращения: 1,06 радиуса габарита, но не ближе 15 м.
export const handleDistance = (radiusOnMap: number): number => Math.max(radiusOnMap * 1.06, 15);

// Направление ручки при повороте r: rotation = −atan2(e, n), значит e = −d·sin r, n = d·cos r.
// При нулевом повороте ручка смотрит строго на север.
export function handleEnu(rotation: number, distance: number): PlaneEnu {
  const r = toRad(rotation);
  return { e: -distance * Math.sin(r), n: distance * Math.cos(r) };
}

// Приведение угла к (−180°, 180°].
export function normalizeAngle(degrees: number): number {
  let d = degrees % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

// Угол по положению ручки: E — вправо, N — вверх, поэтому поворот против часовой даёт
// отрицательный азимут.
export const rotationFromEnu = ({ e, n }: PlaneEnu): number =>
  normalizeAngle(-Math.atan2(e, n) / (Math.PI / 180));

// Азимут локальной оси +Y — то, что оператор сверяет с чертежом.
export function azimuthY(rotation: number): number {
  let a = -rotation % 360;
  if (a < 0) a += 360;
  return a;
}

// Ожидаемая погрешность модели на площадке радиуса r: касательная плоскость отходит от эллипсоида
// примерно на r³/(3·R²).
export const expectedError = (radius: number): number =>
  (radius * radius * radius) / (3 * R_MEAN * R_MEAN);

export type Binding = { anchor: LatLon; rotation: number };

export type Comparison = {
  shift: number;
  azimuth: number;
  rotation: number;
  scaleRel: number;
};

// Расхождение текущей привязки с эталоном. Сдвиг опорной точки меряется по геодезической линии,
// а не по касательной плоскости. Все величины — текущая привязка относительно эталонной: поворот
// как разность со знаком по кратчайшей дуге, масштаб как относительная разница. Сдвиг знака
// не имеет, это расстояние.
export function compare(
  current: Binding & { scale: number },
  reference: Binding & { scale: number },
): Comparison {
  const line = vincentyInverse(reference.anchor, current.anchor);
  return {
    shift: line.distance,
    azimuth: line.azimuth,
    rotation: normalizeAngle(current.rotation - reference.rotation),
    scaleRel: reference.scale === 0 ? NaN : current.scale / reference.scale - 1,
  };
}

// Разброс по всем привязкам сразу, включая текущую: наибольшее попарное расхождение по положению
// и по повороту.
export function spread(bindings: readonly Binding[]): {
  shift: number;
  rotation: number;
  count: number;
} {
  let shift = 0;
  let rotation = 0;
  bindings.forEach((a, i) => {
    for (const b of bindings.slice(i + 1)) {
      shift = Math.max(shift, vincentyInverse(a.anchor, b.anchor).distance);
      rotation = Math.max(rotation, Math.abs(normalizeAngle(a.rotation - b.rotation)));
    }
  });
  return { shift, rotation, count: bindings.length };
}

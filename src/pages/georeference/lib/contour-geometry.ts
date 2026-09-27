import type { Feature, FeatureCollection, LineString, MultiPolygon, Point, Polygon } from 'geojson';

import {
  enuToGeodetic,
  geodeticToEnu,
  type LatLon,
  type LocalPoint,
  type PlaneEnu,
  vincentyInverse,
} from '@/shared/lib/geodesy';
import {
  formatDecimal,
  formatLength,
  frameOf,
  handleDistance,
  handleEnu,
  normalizeAngle,
  type Placement,
  rotationFromEnu,
  sizeOnMap,
  vertexLatLon,
} from '@/shared/lib/georeference';

// Точки вершин рисуются, пока их не больше тысячи: дальше перерисовка на каждое движение мыши
// заметно медленнее, а точки сливаются в линию (прототип, ../geojson/js/ui.js:981).
export const MAX_DRAWN_VERTICES = 1000;

// Во время жеста контур крупнее этого рисуется прореженным: пересчёт в WGS 84 — несколько
// микросекунд на вершину, и 50 000 вершин не успевали бы за кадром. Точная форма — после
// отпускания.
export const GESTURE_VERTEX_LIMIT = 5000;

type Polygons = readonly (readonly (readonly LocalPoint[])[])[];

// Каждая k-я вершина кольца: форма та же, вершин не больше limit на весь контур. Кольцо, от
// которого осталось бы меньше трёх вершин, остаётся целым.
export function thinOut(polygons: Polygons, limit: number): Polygons {
  const total = polygons.reduce(
    (sum, rings) => sum + rings.reduce((count, ring) => count + ring.length, 0),
    0,
  );
  if (total <= limit) return polygons;
  const stride = Math.ceil(total / limit);
  return polygons.map((rings) =>
    rings.map((ring) => {
      const kept = ring.filter((_, index) => index % stride === 0);
      return kept.length >= 3 ? kept : ring;
    }),
  );
}

const lonLat = ({ lat, lon }: LatLon): [number, number] => [lon, lat];

// Контур на карте: MultiPolygon в WGS 84 с замкнутыми кольцами.
export function contourFeature(
  placement: Placement,
  polygons: Polygons = placement.source.polygons,
): FeatureCollection<MultiPolygon> {
  const frame = frameOf(placement);
  const coordinates = polygons.map((rings) =>
    rings.map((ring) => {
      const points = ring.map((point) => lonLat(vertexLatLon(point, placement, frame)));
      const first = points[0];
      return first === undefined ? points : [...points, first];
    }),
  );
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates } },
    ],
  };
}

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

export function verticesFeature(placement: Placement): FeatureCollection<Point> {
  const { vertices } = placement.source;
  if (vertices.length > MAX_DRAWN_VERTICES) return { type: 'FeatureCollection', features: [] };
  const frame = frameOf(placement);
  return {
    type: 'FeatureCollection',
    features: vertices.map((vertex): Feature<Point> => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: lonLat(vertexLatLon(vertex, placement, frame)) },
    })),
  };
}

export const pointFeature = (point: LatLon): FeatureCollection<Point> => ({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: lonLat(point) } },
  ],
});

// Ручка поворота: 1,06 радиуса габарита на карте, но не ближе 15 м от опорной точки, в сторону
// поворота; при нулевом повороте — строго на север.
export function handlePosition(placement: Placement): LatLon {
  const distance = handleDistance(sizeOnMap(placement).radius);
  const { lat, lon } = enuToGeodetic(handleEnu(placement.rotation, distance), placement.anchor);
  return { lat, lon };
}

export const leverFeature = (anchor: LatLon, handle: LatLon): FeatureCollection<LineString> => ({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [lonLat(anchor), lonLat(handle)] },
    },
  ],
});

// Сектор поворота от угла начала жеста до текущего — по короткой дуге, чтобы он не
// оборачивался вокруг; радиус — чуть больше половины рычага (прототип, layers.js:329-356).
export function sectorFeature(
  placement: Placement,
  from: number,
): FeatureCollection<Polygon> | typeof EMPTY {
  const delta = normalizeAngle(placement.rotation - from);
  if (delta === 0) return EMPTY;
  const radius = handleDistance(sizeOnMap(placement).radius) * 0.55;
  const steps = Math.max(2, Math.ceil(Math.abs(delta) / 3));
  const arc = Array.from({ length: steps + 1 }, (_, index) => {
    const angle = ((from + (delta * index) / steps) * Math.PI) / 180;
    const { lat, lon } = enuToGeodetic(
      { e: -radius * Math.sin(angle), n: radius * Math.cos(angle) },
      placement.anchor,
    );
    return [lon, lat];
  });
  const center = lonLat(placement.anchor);
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [[center, ...arc, center]] },
      },
    ],
  };
}

// Смещение опорной точки от курсора в ENU — фиксируется в момент захвата.
export const grabOffset = (anchor: LatLon, cursor: LatLon): PlaneEnu => {
  const { e, n } = geodeticToEnu({ ...anchor, h: 0 }, { ...cursor, h: 0 });
  return { e, n };
};

// Новая опорная точка при перетаскивании: то же смещение от нового положения курсора.
// Смещение постоянное, а не приращения от кадра к кадру: приращения копят ошибку, и контур
// уползает от курсора.
export function draggedAnchor(offset: PlaneEnu, cursor: LatLon): LatLon {
  const { lat, lon } = enuToGeodetic(offset, cursor);
  return { lat, lon };
}

export const ROTATION_STEP_DEG = 15;

// Поворот по положению ручки: свободный, с Shift — к кратному 15°. Так принято в чертёжных
// инструментах, и только так можно мерить угловую точность: округление до ±7,5° на контуре
// радиусом 200 м уводит дальнюю вершину на 26 м (прототип, layers.js:456-459).
export function rotationAt(anchor: LatLon, handle: LatLon, snap: boolean): number {
  const { e, n } = geodeticToEnu({ ...handle, h: 0 }, { ...anchor, h: 0 });
  const degrees = rotationFromEnu({ e, n });
  return snap
    ? normalizeAngle(Math.round(degrees / ROTATION_STEP_DEG) * ROTATION_STEP_DEG)
    : degrees;
}

// Рамка вписывания симметрична относительно опорной точки и включает ручку: иначе после
// возврата центра в опорную точку край уходит за кадр (прототип, layers.js:574-605).
export function fitBounds(
  placement: Placement,
): [west: number, south: number, east: number, north: number] {
  const frame = frameOf(placement);
  const { anchor } = placement;
  let dLat = 0;
  let dLon = 0;
  const include = ({ lat, lon }: LatLon) => {
    dLat = Math.max(dLat, Math.abs(lat - anchor.lat));
    dLon = Math.max(dLon, Math.abs(lon - anchor.lon));
  };
  for (const vertex of placement.source.vertices) include(vertexLatLon(vertex, placement, frame));
  include(handlePosition(placement));
  dLat ||= 1e-4;
  dLon ||= 1e-4;
  return [anchor.lon - dLon, anchor.lat - dLat, anchor.lon + dLon, anchor.lat + dLat];
}

// Метры на пиксель в центре вида — по самой карте: две точки в пикселе друг от друга, расстояние
// по эллипсоиду. Так верно на любой широте и при любой проекции карты.
export function metersPerPixel(
  unproject: (point: [number, number]) => LatLon,
  center: [x: number, y: number],
): number {
  const a = unproject(center);
  const b = unproject([center[0] + 1, center[1]]);
  return vincentyInverse(a, b).distance;
}

// Знаменатель масштаба при пикселе 0,28 мм (OGC).
export const scaleDenominator = (mpp: number): number => mpp / 0.00028;

// Погрешность модели касательной плоскости: миллиметры для малых, метры для больших площадок.
export function formatModelError(meters: number): string {
  if (meters >= 1) return formatLength(meters);
  const mm = meters * 1000;
  if (mm < 0.01) return 'менее 0,01\u00A0мм';
  return `${formatDecimal(mm, mm < 10 ? 2 : 1)}\u00A0мм`;
}

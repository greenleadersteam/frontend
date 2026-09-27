import { metersPerDegree } from '@/shared/lib/geodesy';

// Точка GeoJSON: [x, y] в локальных метрах чертежа или [lon, lat] в WGS84.
export type Position = readonly number[];

export type Extent = { minX: number; minY: number; maxX: number; maxY: number };

export type PlanProjection = {
  project: (position: Position) => [x: number, y: number];
  pixelsPerMeter: number;
};

// Метка бэкенда для геометрии без геопривязки: ../backend/greenplan/export/geojson.py:18.
const LOCAL_CRS = 'local drawing coordinates, no geo-reference available';

export const isGeographic = (crs: string): boolean => crs !== LOCAL_CRS;

export function extentOf(positions: Position[]): Extent | null {
  let extent: Extent | null = null;
  for (const [x, y] of positions) {
    if (x === undefined || y === undefined) continue;
    extent =
      extent === null
        ? { minX: x, minY: y, maxX: x, maxY: y }
        : {
            minX: Math.min(extent.minX, x),
            minY: Math.min(extent.minY, y),
            maxX: Math.max(extent.maxX, x),
            maxY: Math.max(extent.maxY, y),
          };
  }
  return extent;
}

type ProjectionOptions = {
  extent: Extent;
  width: number;
  height: number;
  geographic: boolean;
  // Доля размера холста под поле с каждой стороны.
  padding?: number;
};

// Равнопромежуточная проекция: для WGS84 долгота сжимается отношением длин градуса долготы
// и широты на средней широте (эллипсоид, metersPerDegree), чтобы метр по горизонтали и по
// вертикали был одной длины. Север — вверх.
export function createPlanProjection({
  extent,
  width,
  height,
  geographic,
  padding = 0.08,
}: ProjectionOptions): PlanProjection {
  const degree = metersPerDegree((extent.minY + extent.maxY) / 2);
  const xScale = geographic ? degree.lon / degree.lat : 1;
  const spanX = Math.max((extent.maxX - extent.minX) * xScale, Number.EPSILON);
  const spanY = Math.max(extent.maxY - extent.minY, Number.EPSILON);

  const innerWidth = width * (1 - 2 * padding);
  const innerHeight = height * (1 - 2 * padding);
  const scale = Math.min(innerWidth / spanX, innerHeight / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;

  return {
    project: ([x = 0, y = 0]) => [
      offsetX + (x - extent.minX) * xScale * scale,
      offsetY + (extent.maxY - y) * scale,
    ],
    pixelsPerMeter: geographic ? scale / degree.lat : scale,
  };
}

// В /planting размера кроны нет, у правил посадки тоже: радиус берётся по типу посадки,
// как у окружностей в DXF (../backend/greenplan/io/dxf_sink.py:20-21).
export const CROWN_RADIUS_M = { tree: 1.5, shrub: 0.35 } as const;

// Мельче посадку на мелком масштабе не видно. Одно правило для превью и для карты.
export const MIN_CROWN_RADIUS_PX = 1.5;

export const crownRadiusPx = (radiusM: number, pixelsPerMeter: number): number =>
  Math.max(radiusM * pixelsPerMeter, MIN_CROWN_RADIUS_PX);

// Веб-Меркатор MapLibre: мир на zoom z — 512 · 2^z пикселей по экватору, на широте φ
// метр длиннее в 1 / cos φ раз.
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

export const pixelsPerMeterAtZoom = (zoom: number, latitude: number): number =>
  (512 * 2 ** zoom) / (EARTH_CIRCUMFERENCE_M * Math.cos((latitude * Math.PI) / 180));

// Точка GeoJSON: [x, y] в локальных метрах чертежа или [lon, lat] в WGS84.
export type Position = readonly number[];

export type Extent = { minX: number; minY: number; maxX: number; maxY: number };

export type PlanProjection = {
  project: (position: Position) => [x: number, y: number];
  pixelsPerMeter: number;
};

const METERS_PER_DEGREE = 111_320;

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

// Равнопромежуточная проекция: для WGS84 долгота сжимается на cos φ средней широты,
// чтобы метр по горизонтали и по вертикали был одной длины. Север — вверх.
export function createPlanProjection({
  extent,
  width,
  height,
  geographic,
  padding = 0.08,
}: ProjectionOptions): PlanProjection {
  const xScale = geographic ? Math.cos((((extent.minY + extent.maxY) / 2) * Math.PI) / 180) : 1;
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
    pixelsPerMeter: geographic ? scale / METERS_PER_DEGREE : scale,
  };
}

// Радиусы крон — как у окружностей в DXF: ../backend/greenplan/io/dxf_sink.py:19-20.
// На мелком масштабе радиус не меньше минимального, иначе посадки не видны.
const CROWN_RADIUS_M = { tree: 1.5, shrub: 0.35 };
const MIN_RADIUS_PX = { tree: 2, shrub: 1.25 };

export const crownRadiusPx = (plantType: 'tree' | 'shrub', pixelsPerMeter: number): number =>
  Math.max(CROWN_RADIUS_M[plantType] * pixelsPerMeter, MIN_RADIUS_PX[plantType]);

import type { PlantingFeatureCollection, ZonesFeatureCollection } from '../api/project-result-api';
import {
  createPlanProjection,
  CROWN_RADIUS_M,
  crownRadiusPx,
  extentOf,
  isGeographic,
  type PlanProjection,
  type Position,
} from '../lib/plan-projection';

type ZoneGeometry = ZonesFeatureCollection['features'][number]['geometry'];

const polygonsOf = (geometry: ZoneGeometry): number[][][][] =>
  geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

// Canvas не понимает var(): цвета читаются из CSS-переменных темы на самом холсте.
const themeColor = (canvas: HTMLCanvasElement, name: string): string =>
  getComputedStyle(canvas).getPropertyValue(name).trim();

type PlanData = { planting: PlantingFeatureCollection; zones: ZonesFeatureCollection };

// Мини-план по design.md, «Карта»: зоны запрета clay.3 с прозрачностью 25%,
// кустарники sage.4, деревья sage.7 с бликом sage.6. Подложки нет.
export function drawPlan(
  canvas: HTMLCanvasElement,
  { planting, zones }: PlanData,
  width: number,
  height: number,
): void {
  const context = canvas.getContext('2d');
  if (context === null || width === 0 || height === 0) return;

  const ratio = window.devicePixelRatio;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const prohibited = zones.features.filter(
    ({ properties }) => properties.zone_type === 'prohibited',
  );
  const positions: Position[] = [
    ...zones.features.flatMap(({ geometry }) => polygonsOf(geometry).flat(2)),
    ...planting.features.map(({ geometry }) => geometry.coordinates),
  ];
  const extent = extentOf(positions);
  if (extent === null) return;

  const projection = createPlanProjection({
    extent,
    width,
    height,
    // Метка CRS — из /zones: задеплоенный бэкенд пока не отдаёт metadata в /planting.
    geographic: isGeographic(zones.metadata.crs),
  });

  context.globalAlpha = 0.25;
  context.fillStyle = themeColor(canvas, '--mantine-color-clay-3');
  for (const { geometry } of prohibited) fillPolygons(context, projection, geometry);
  context.globalAlpha = 1;

  const colors = {
    shrub: themeColor(canvas, '--mantine-color-sage-4'),
    tree: themeColor(canvas, '--mantine-color-sage-7'),
    highlight: themeColor(canvas, '--mantine-color-sage-6'),
  };
  // Кустарники рисуются первыми: кроны деревьев крупнее и ложатся сверху.
  const byType = [...planting.features].sort((a, b) =>
    a.properties.plant_type === b.properties.plant_type
      ? 0
      : a.properties.plant_type === 'shrub'
        ? -1
        : 1,
  );
  for (const { geometry, properties } of byType) {
    const [x, y] = projection.project(geometry.coordinates);
    const radius = crownRadiusPx(CROWN_RADIUS_M[properties.plant_type], projection.pixelsPerMeter);
    fillCircle(context, x, y, radius, colors[properties.plant_type]);
    if (properties.plant_type === 'tree') {
      fillCircle(context, x - radius * 0.3, y - radius * 0.3, radius * 0.45, colors.highlight);
    }
  }
}

function fillPolygons(
  context: CanvasRenderingContext2D,
  projection: PlanProjection,
  geometry: ZoneGeometry,
): void {
  context.beginPath();
  for (const polygon of polygonsOf(geometry)) {
    for (const ring of polygon) {
      ring.forEach((position, index) => {
        const [x, y] = projection.project(position);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
    }
  }
  context.fill('evenodd');
}

function fillCircle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  context.beginPath();
  context.arc(x, y, radius, 0, 2 * Math.PI);
  context.fillStyle = color;
  context.fill();
}

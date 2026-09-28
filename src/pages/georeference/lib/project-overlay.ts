import type { FeatureCollection, MultiPolygon, Point } from 'geojson';

import type {
  PlantingFeatureCollection,
  PlantType,
  ZonesFeatureCollection,
} from '@/entities/project';
import type { LocalPoint } from '@/shared/lib/geodesy';
import { type PlacementCore, placementTransform } from '@/shared/lib/georeference';

// План проекта под контуром — подсказка для совмещения по снимку: посадки и зоны запрета.
// Он пересчитывается на каждую фиксацию положения (отпускание мыши, клавишу, пару точек), а у
// «Олимпийского» в зонах запрета 823 тыс. вершин. Упрощение Дугласа — Пекера с допуском 10 см
// оставляет около 140 тыс.: на подложке это меньше пикселя даже на 20-м масштабе.
const OVERLAY_TOLERANCE_M = 0.1;

type Ring = LocalPoint[];

export type ProjectOverlay = {
  // Полигоны зон запрета: кольца в метрах чертежа, замкнутые.
  zones: Ring[][];
  plantings: { point: LocalPoint; plantType: PlantType }[];
};

// Расстояние от точки до отрезка ab.
function distanceToSegment(p: LocalPoint, a: LocalPoint, b: LocalPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Дуглас — Пекер без рекурсии: у кольца зоны запрета бывают десятки тысяч вершин.
export function simplifyLine(points: readonly LocalPoint[], tolerance: number): LocalPoint[] {
  if (points.length < 3) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  for (let span = stack.pop(); span !== undefined; span = stack.pop()) {
    const [from, to] = span;
    const a = points[from];
    const b = points[to];
    if (a === undefined || b === undefined) continue;
    let farthest = -1;
    let distance = tolerance;
    for (let index = from + 1; index < to; index += 1) {
      const point = points[index];
      if (point === undefined) continue;
      const d = distanceToSegment(point, a, b);
      if (d > distance) {
        distance = d;
        farthest = index;
      }
    }
    if (farthest === -1) continue;
    keep[farthest] = 1;
    stack.push([from, farthest], [farthest, to]);
  }
  return points.filter((_, index) => keep[index] === 1);
}

const toPoint = ([x = 0, y = 0]: readonly number[]): LocalPoint => ({ x, y });

// Кольцо, от которого после упрощения не осталось площади, отбрасывается; полигон без внешнего
// кольца — тоже.
function simplifyPolygon(rings: readonly (readonly (readonly number[])[])[]): Ring[] | null {
  const simplified = rings.map((ring) => simplifyLine(ring.map(toPoint), OVERLAY_TOLERANCE_M));
  const [outer, ...holes] = simplified;
  if (outer === undefined || outer.length < 4) return null;
  return [outer, ...holes.filter((ring) => ring.length >= 4)];
}

// Подготовка один раз на проект: упрощённые зоны запрета обоих типов посадки и точки посадок.
export function prepareOverlay(
  zones: ZonesFeatureCollection,
  planting: PlantingFeatureCollection,
): ProjectOverlay {
  const polygons = zones.features.flatMap(({ geometry, properties }) => {
    if (properties.zone_type !== 'prohibited') return [];
    const list = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return list.flatMap((rings) => {
      const polygon = simplifyPolygon(rings);
      return polygon === null ? [] : [polygon];
    });
  });
  return {
    zones: polygons,
    plantings: planting.features.map(({ geometry, properties }) => ({
      point: toPoint(geometry.coordinates),
      plantType: properties.plant_type,
    })),
  };
}

// План на карте в текущем положении контура — тем же путём «чертёж → WGS84», что и контур.
export function overlayFeatures(
  overlay: ProjectOverlay,
  placement: PlacementCore,
): {
  zones: FeatureCollection<MultiPolygon>;
  plantings: FeatureCollection<Point, { plant_type: PlantType }>;
} {
  const { toLatLon } = placementTransform(placement);
  const lonLat = (point: LocalPoint): [number, number] => {
    const { lat, lon } = toLatLon(point);
    return [lon, lat];
  };
  return {
    zones: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'MultiPolygon',
            coordinates: overlay.zones.map((rings) => rings.map((ring) => ring.map(lonLat))),
          },
        },
      ],
    },
    plantings: {
      type: 'FeatureCollection',
      features: overlay.plantings.map(({ point, plantType }) => ({
        type: 'Feature',
        properties: { plant_type: plantType },
        geometry: { type: 'Point', coordinates: lonLat(point) },
      })),
    },
  };
}

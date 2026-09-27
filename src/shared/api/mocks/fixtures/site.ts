import type { components } from '../../generated/proposed';
import { processingDefaults } from './processing-defaults';

type Schemas = components['schemas'];
type PlantType = Schemas['PlantType'];
type ZoneFeature = Schemas['ZoneFeature'];

// Настоящий формат /explanation — плоский список без норм и расстояний
// (../backend/greenplan/explain/builder.py:17-32), координаты — в метрах чертежа. Схемы
// ответа в OpenAPI нет; тот же тип у endpoint'а в entities/project (shared его не видит).
export type ExplanationEntry = {
  id: string;
  plant_type: PlantType;
  rule_id: string;
  rule_name_ru: string | null;
  x: number;
  y: number;
};

export type RunParams = {
  plantTypes: readonly PlantType[];
  rules: Readonly<Record<string, { spacing: number; offset: number | null }>>;
};

export type SiteResult = {
  explanation: ExplanationEntry[];
  zones: Schemas['ZonesFeatureCollection'];
  planting: Schemas['PlantingFeatureCollection'];
};

type Point = readonly [x: number, y: number];
type Rect = { x1: number; y1: number; x2: number; y2: number };
type Shape = { kind: 'segment'; from: Point; to: Point } | { kind: 'point'; at: Point };

// Участок 60 × 20 м вдоль улицы: бортовой камень по нижней кромке газона, под газоном кабель
// и газопровод вдоль улицы, поперёк — водопровод, на газоне одно существующее дерево.
// В бэкенде тестовых DXF нет (../backend/tests собирает их в коде), поэтому геометрия своя.
const LAWN: Rect = { x1: 0, y1: 0, x2: 60, y2: 20 };
const SITE_BOUNDARY: Rect = { x1: 0, y1: -3, x2: 60, y2: 20 };

// Участок на Покровке. Равнопромежуточная проекция точна до сантиметров на 60 м.
const ORIGIN = { lon: 37.6452, lat: 55.7593 };
const METERS_PER_DEGREE = 111_320;
const toLonLat = (x: number, y: number): [number, number] => [
  ORIGIN.lon + x / (METERS_PER_DEGREE * Math.cos((ORIGIN.lat * Math.PI) / 180)),
  ORIGIN.lat + y / METERS_PER_DEGREE,
];

// Нормы и отступы — ../backend/greenplan/norms/default.yaml. Пунктов в источнике нет.
type SiteNorm = { id: string; row: string; tree: number; shrub: number };

const NORMS = {
  roadEdge: { id: '743-pp-road-edge', row: 'край тротуара/бортовой камень', tree: 0.7, shrub: 0.5 },
  powerCable: {
    id: '743-pp-power-cable',
    row: 'силовой кабель и кабель связи',
    tree: 2,
    shrub: 0.7,
  },
  gas: { id: '743-pp-gas', row: 'газопровод', tree: 1.5, shrub: 1.5 },
  water: { id: '743-pp-water', row: 'водопровод, дренаж', tree: 2, shrub: 2 },
  existingTree: {
    id: '743-pp-existing-tree',
    row: 'расстояние между озеленением, однорядная посадка',
    tree: 5,
    shrub: 1.5,
  },
} satisfies Record<string, SiteNorm>;

type SiteObstacle = {
  norm: SiteNorm;
  obstacle: { category: string; subtype: string | null };
  shape: Shape;
};

const OBSTACLES: SiteObstacle[] = [
  {
    norm: NORMS.roadEdge,
    obstacle: {
      category: 'road_edge',
      subtype: null,
    },
    shape: { kind: 'segment', from: [0, 0], to: [60, 0] },
  },
  {
    norm: NORMS.powerCable,
    obstacle: {
      category: 'underground_utilities',
      subtype: 'power_cable',
    },
    shape: { kind: 'segment', from: [0, 4.5], to: [60, 4.5] },
  },
  {
    norm: NORMS.gas,
    obstacle: {
      category: 'underground_utilities',
      subtype: 'gas',
    },
    shape: { kind: 'segment', from: [0, 12], to: [60, 12] },
  },
  {
    norm: NORMS.water,
    obstacle: {
      category: 'underground_utilities',
      subtype: 'water',
    },
    shape: { kind: 'segment', from: [28, 0], to: [28, 20] },
  },
  {
    norm: NORMS.existingTree,
    obstacle: {
      category: 'green_existing',
      subtype: 'existing_tree',
    },
    shape: { kind: 'point', at: [48, 16] },
  },
];

const range = (from: number, to: number, step: number): number[] => {
  const values: number[] = [];
  for (let value = from; value <= to + 1e-9; value += step) values.push(value);
  return values;
};

const grid = (xs: number[], ys: number[]): Point[] =>
  ys.flatMap((y) => xs.map((x) => [x, y] as const));

const row = (xs: number[], offset: number | null): Point[] =>
  offset === null ? [] : xs.map((x) => [x, offset] as const);

// Где правило ищет места: ряды — вдоль борта на отступе offset, заполнение — сеткой на газоне.
// Ряд без отступа не строится: у правил вдоль борта отступ всегда есть в processingDefaults.
const CANDIDATES: Record<string, (spacing: number, offset: number | null) => Point[]> = {
  TREE_ROW_CURB: (spacing, offset) => row(range(spacing / 2, LAWN.x2 - 1, spacing), offset),
  SHRUB_HEDGE_CURB: (spacing, offset) => row(range(46.5, 58.5, spacing), offset),
  TREE_FILL_LAWN: (spacing) => grid(range(32.5, 59, spacing), range(8, 19, spacing)),
  SHRUB_FILL_LAWN: (spacing) => grid(range(1.5, 13.5, spacing), range(8, 15, spacing)),
};

function distance([px, py]: Point, shape: Shape): number {
  if (shape.kind === 'point') return Math.hypot(px - shape.at[0], py - shape.at[1]);
  const [ax, ay] = shape.from;
  const [bx, by] = shape.to;
  const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / lengthSquared),
  );
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
}

const round = (value: number, digits: number): number => Number(value.toFixed(digits));

const setback = (norm: SiteNorm, plantType: PlantType): number =>
  plantType === 'tree' ? norm.tree : norm.shrub;

// Раскладка бэкенда ставит посадку, только если её точка вне всех буферов
// (../backend/greenplan/layout/engine.py:71,103).
const violatesSetback = (point: Point, plantType: PlantType): boolean =>
  OBSTACLES.some(({ norm, shape }) => distance(point, shape) < setback(norm, plantType));

const intersect = (a: Rect, b: Rect): Rect | null => {
  const rect = {
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
    x2: Math.min(a.x2, b.x2),
    y2: Math.min(a.y2, b.y2),
  };
  return rect.x1 < rect.x2 && rect.y1 < rect.y2 ? rect : null;
};

const boundsOf = (shape: Shape, buffer: number): Rect =>
  shape.kind === 'point'
    ? {
        x1: shape.at[0] - buffer,
        y1: shape.at[1] - buffer,
        x2: shape.at[0] + buffer,
        y2: shape.at[1] + buffer,
      }
    : {
        x1: Math.min(shape.from[0], shape.to[0]) - buffer,
        y1: Math.min(shape.from[1], shape.to[1]) - buffer,
        x2: Math.max(shape.from[0], shape.to[0]) + buffer,
        y2: Math.max(shape.from[1], shape.to[1]) + buffer,
      };

const consecutivePairs = (values: number[]): [number, number][] =>
  values.flatMap((start, index) => {
    const end = values[index + 1];
    return end === undefined ? [] : [[start, end] as [number, number]];
  });

// Разность прямоугольников через сетку по всем их кромкам. Буфер вокруг дерева вычитается
// описанным квадратом: разрешённая зона выходит чуть меньше настоящей, для мока это допустимо.
function subtract(base: Rect, holes: Rect[]): Rect[] {
  const edges = (pick: (rect: Rect) => number[]) =>
    [...new Set([base, ...holes].flatMap(pick))].sort((a, b) => a - b);
  const columns = consecutivePairs(edges((rect) => [rect.x1, rect.x2]));
  const rows = consecutivePairs(edges((rect) => [rect.y1, rect.y2]));

  return rows.flatMap(([y1, y2]) => {
    const runs: Rect[] = [];
    let runStart: number | null = null;
    let runEnd = 0;
    for (const [x1, x2] of columns) {
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const free = !holes.some(
        (hole) => cx > hole.x1 && cx < hole.x2 && cy > hole.y1 && cy < hole.y2,
      );
      if (free) {
        runStart ??= x1;
        runEnd = x2;
      } else if (runStart !== null) {
        runs.push({ x1: runStart, y1, x2: runEnd, y2 });
        runStart = null;
      }
    }
    if (runStart !== null) runs.push({ x1: runStart, y1, x2: runEnd, y2 });
    return runs;
  });
}

function buildZones(plantTypes: readonly PlantType[], project: (point: Point) => number[]) {
  const ring = (points: Point[]): number[][] => [...points, ...points.slice(0, 1)].map(project);
  const rectRing = ({ x1, y1, x2, y2 }: Rect) =>
    ring([
      [x1, y1],
      [x2, y1],
      [x2, y2],
      [x1, y2],
    ]);

  const polygon = (rect: Rect): ZoneFeature['geometry'] => ({
    type: 'Polygon',
    coordinates: [rectRing(rect)],
  });

  // Круг из 32 вершин, прижатый к газону: для выпуклой фигуры и прямоугольника это
  // приближение пересечения, на масштабе мока неотличимое от точного.
  const circle = (center: Point, radius: number): ZoneFeature['geometry'] => ({
    type: 'Polygon',
    coordinates: [
      ring(
        range(0, 31, 1).map((step) => {
          const angle = (step / 32) * 2 * Math.PI;
          return [
            Math.min(LAWN.x2, Math.max(LAWN.x1, center[0] + radius * Math.cos(angle))),
            Math.min(LAWN.y2, Math.max(LAWN.y1, center[1] + radius * Math.sin(angle))),
          ] as const;
        }),
      ),
    ],
  });

  const extents: ZoneFeature[] = [
    {
      type: 'Feature',
      geometry: polygon(SITE_BOUNDARY),
      properties: { zone_type: 'site_boundary' },
    },
    { type: 'Feature', geometry: polygon(LAWN), properties: { zone_type: 'lawn_raw' } },
    { type: 'Feature', geometry: polygon(LAWN), properties: { zone_type: 'base_area' } },
  ];

  const allowed: ZoneFeature[] = plantTypes.map((plantType) => ({
    type: 'Feature',
    geometry: {
      type: 'MultiPolygon',
      coordinates: subtract(
        LAWN,
        OBSTACLES.map(({ norm, shape }) => boundsOf(shape, setback(norm, plantType))),
      ).map((rect) => [rectRing(rect)]),
    },
    properties: { zone_type: 'allowed', plant_type: plantType },
  }));

  const prohibited: ZoneFeature[] = plantTypes.flatMap((plantType) =>
    OBSTACLES.flatMap(({ norm, obstacle, shape }) => {
      const buffer = setback(norm, plantType);
      const clipped = intersect(boundsOf(shape, buffer), LAWN);
      if (clipped === null) return [];
      return [
        {
          type: 'Feature',
          geometry: shape.kind === 'point' ? circle(shape.at, buffer) : polygon(clipped),
          // Формат citation и reason — как у бэкенда: ../backend/greenplan/zoning/engine.py:141-151.
          properties: {
            zone_type: 'prohibited',
            plant_type: plantType,
            obstacle_category: obstacle.category,
            obstacle_subtype: obstacle.subtype,
            distance_m: buffer,
            citation: `743-ПП — ${norm.row}`,
            reason: `< ${String(buffer)} м от объекта типа «${obstacle.subtype ?? obstacle.category}»`,
          },
        } satisfies ZoneFeature,
      ];
    }),
  );

  return [...extents, ...allowed, ...prohibited];
}

// Категории, которые есть в подоснове, но для которых у бэкенда нет нормы: отступ от них
// не строился (../backend/greenplan/zoning/engine.py:158-168).
const UNCOVERED_CATEGORIES = [{ category: 'wells_hatches', subtype: null }];

type Placed = { id: string; plantType: PlantType; ruleId: string; ruleName: string; point: Point };

export function buildSiteResult(params: RunParams, georeferenced: boolean): SiteResult {
  const placed: Placed[] = [];

  for (const [ruleId, rule] of Object.entries(params.rules)) {
    const defaults = processingDefaults.planting_rules[ruleId];
    const candidates = CANDIDATES[ruleId];
    if (defaults === undefined || candidates === undefined) continue;
    const plantType = defaults.plant_type;
    if (!params.plantTypes.includes(plantType)) continue;

    for (const point of candidates(rule.spacing, rule.offset)) {
      if (violatesSetback(point, plantType)) continue;
      placed.push({
        id: `${ruleId}-${String(placed.length + 1).padStart(5, '0')}`,
        plantType,
        ruleId,
        ruleName: defaults.name_ru,
        point,
      });
    }
  }

  const project = ([x, y]: Point): number[] => (georeferenced ? toLonLat(x, y) : [x, y]);
  const crs = georeferenced
    ? 'EPSG:4326 (WGS84 lon/lat)'
    : 'local drawing coordinates, no geo-reference available';

  return {
    explanation: placed.map(({ id, plantType, ruleId, ruleName, point: [x, y] }) => ({
      id,
      plant_type: plantType,
      rule_id: ruleId,
      rule_name_ru: ruleName,
      x: round(x, 2),
      y: round(y, 2),
    })),
    zones: {
      type: 'FeatureCollection',
      metadata: { crs, used_site_boundary: true, uncovered_categories: UNCOVERED_CATEGORIES },
      features: buildZones(params.plantTypes, project),
    },
    planting: {
      type: 'FeatureCollection',
      metadata: { crs },
      features: placed.map(({ id, plantType, ruleId, point }) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: project(point) },
        properties: { id, plant_type: plantType, rule_id: ruleId },
      })),
    },
  };
}

import type { components } from '../../generated/proposed';
import { processingDefaults } from './processing-defaults';

type Schemas = components['schemas'];
type PlantType = Schemas['PlantType'];
type Check = Schemas['Check'];
type Position = Schemas['Position'];
type ZoneFeature = Schemas['ZoneFeature'];

export type RunParams = {
  plantTypes: readonly PlantType[];
  rules: Readonly<Record<string, { spacing: number; offset: number | null }>>;
};

export type SiteResult = {
  explanation: Schemas['Explanation'];
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

// Нормы и отступы — ../backend/greenplan/norms/default.yaml. Пунктов в источнике нет,
// поэтому clause везде null.
const ACT = 'ПП Москвы от 10.09.2002 № 743-ПП';

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

type SiteObstacle = { norm: SiteNorm; obstacle: Schemas['Obstacle']; shape: Shape };

const OBSTACLES: SiteObstacle[] = [
  {
    norm: NORMS.roadEdge,
    obstacle: {
      category: 'road_edge',
      subtype: null,
      label_ru: 'бортовой камень',
      layer: 'БР_КАМЕНЬ',
      handle: '1F4',
    },
    shape: { kind: 'segment', from: [0, 0], to: [60, 0] },
  },
  {
    norm: NORMS.powerCable,
    obstacle: {
      category: 'underground_utilities',
      subtype: 'power_cable',
      label_ru: 'силовой кабель',
      layer: 'КЛ_0,4кВ',
      handle: '2A9',
    },
    shape: { kind: 'segment', from: [0, 4.5], to: [60, 4.5] },
  },
  {
    norm: NORMS.gas,
    obstacle: {
      category: 'underground_utilities',
      subtype: 'gas',
      label_ru: 'газопровод',
      layer: 'Г_НД',
      handle: '3C1',
    },
    shape: { kind: 'segment', from: [0, 12], to: [60, 12] },
  },
  {
    norm: NORMS.water,
    obstacle: {
      category: 'underground_utilities',
      subtype: 'water',
      label_ru: 'водопровод',
      layer: 'В1',
      handle: '47E',
    },
    shape: { kind: 'segment', from: [28, 0], to: [28, 20] },
  },
  {
    norm: NORMS.existingTree,
    // Дерево из xref: у скопированных сущностей нет handle (../backend/greenplan/model.py:28).
    obstacle: {
      category: 'green_existing',
      subtype: 'existing_tree',
      label_ru: 'существующее дерево',
      layer: 'ДЕР_СУЩ',
      handle: null,
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

const formatMeters = (value: number): string =>
  `${new Intl.NumberFormat('ru-RU').format(value)}\u00A0м`;

function checksAt(point: Point, plantType: PlantType): Check[] {
  return OBSTACLES.map(({ norm, obstacle, shape }) => ({
    obstacle,
    required_m: setback(norm, plantType),
    actual_m: round(distance(point, shape), 2),
    norm_id: norm.id,
  }));
}

function toPosition([x, y]: Point, georeferenced: boolean): Position {
  if (!georeferenced) return { x: round(x, 2), y: round(y, 2), lon: null, lat: null };
  const [lon, lat] = toLonLat(x, y);
  return { x: round(x, 2), y: round(y, 2), lon: round(lon, 7), lat: round(lat, 7) };
}

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

export function buildSiteResult(params: RunParams, georeferenced: boolean): SiteResult {
  const plantings: Schemas['PlantingExplanation'][] = [];
  const rejected: Schemas['RejectedSite'][] = [];

  for (const [ruleId, rule] of Object.entries(params.rules)) {
    const defaults = processingDefaults.planting_rules[ruleId];
    const candidates = CANDIDATES[ruleId];
    if (defaults === undefined || candidates === undefined) continue;
    const plantType = defaults.plant_type;
    if (!params.plantTypes.includes(plantType)) continue;

    for (const point of candidates(rule.spacing, rule.offset)) {
      const checks = checksAt(point, plantType);
      const failed = checks.filter((check) => check.actual_m < check.required_m);
      const position = toPosition(point, georeferenced);
      if (failed.length > 0) {
        rejected.push({ position, plant_type: plantType, failed_checks: failed });
        continue;
      }
      plantings.push({
        id: `${ruleId}-${String(plantings.length + 1).padStart(5, '0')}`,
        plant_type: plantType,
        rule: { id: ruleId, name_ru: defaults.name_ru },
        position,
        checks,
      });
    }
  }

  const project = ([x, y]: Point): number[] => (georeferenced ? toLonLat(x, y) : [x, y]);
  const crs = georeferenced ? 'EPSG:4326' : 'local drawing coordinates, no geo-reference available';

  return {
    explanation: {
      norms: Object.fromEntries(
        Object.values(NORMS).map((norm) => [
          norm.id,
          {
            act: ACT,
            clause: null,
            text: `${norm.row}: для деревьев — не менее ${formatMeters(norm.tree)}, для кустарников — не менее ${formatMeters(norm.shrub)}`,
          },
        ]),
      ),
      plantings,
      rejected,
    },
    zones: {
      type: 'FeatureCollection',
      metadata: { crs, used_site_boundary: true, uncovered_categories: [] },
      features: buildZones(params.plantTypes, project),
    },
    planting: {
      type: 'FeatureCollection',
      metadata: { crs },
      features: plantings.map(({ id, plant_type, rule, position }) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: project([position.x, position.y]),
        },
        properties: { id, plant_type, rule_id: rule.id },
      })),
    },
  };
}

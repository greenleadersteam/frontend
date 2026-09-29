import { isInside, type LocalPoint, nearestOnBoundary } from '@/shared/lib/geometry';
import { type PlacementCore, placementTransform } from '@/shared/lib/georeference';

import type { components } from '../../generated/proposed';
import { NORMS } from './norms';
import { processingDefaults } from './processing-defaults';
import { chooseSpecies } from './species';

type Schemas = components['schemas'];
type PlantType = Schemas['PlantType'];
type ZoneFeature = Schemas['ZoneFeature'];
type ExplanationCheck = Schemas['ExplanationCheck'];
type ManualGeoreference = Schemas['ManualGeoreference'];

export type RunParams = {
  plantTypes: readonly PlantType[];
  rules: Readonly<Record<string, { spacing: number; offset: number | null }>>;
};

// Демо реализует весь контракт-предложение: к формату бэкенда добавлены checks, порода,
// препятствия и отклонённые места.
export type SiteResult = {
  explanation: Schemas['ExplanationEntry'][];
  zones: Schemas['ZonesFeatureCollection'];
  planting: Schemas['PlantingFeatureCollection'];
  obstacles: Schemas['ObstaclesFeatureCollection'];
  rejected: Schemas['RejectedSitesFeatureCollection'];
};

type Point = LocalPoint;
type Rect = { x1: number; y1: number; x2: number; y2: number };
type Shape =
  | { kind: 'segment'; from: Point; to: Point }
  | { kind: 'point'; at: Point }
  | { kind: 'polygon'; ring: Point[] };

// Участок 60 × 20 м вдоль улицы: бортовой камень по нижней кромке газона, за ним тротуар;
// под газоном кабель и газопровод вдоль улицы, поперёк — водопровод, на газоне одно
// существующее дерево и колодец, к северу — здание. В бэкенде тестовых DXF нет (../backend/tests
// собирает их в коде), поэтому геометрия своя.
const LAWN: Rect = { x1: 0, y1: 0, x2: 60, y2: 20 };
const SITE_BOUNDARY: Rect = { x1: 0, y1: -3, x2: 60, y2: 20 };

// Привязка «метры чертежа → WGS84» — подобием вокруг опорной точки, как в контракте
// PUT /georeference: поворот от истинного севера против часовой, масштаб. Точки переводятся теми же
// функциями, что у модуля геопривязки и у плана проекта с ручной привязкой (shared/lib/georeference):
// иначе мок и клиент по-разному положили бы один чертёж на карту.
// Участок на Покровке: так его привязывает bbox_user демо-проекта.
export const DEFAULT_PLACEMENT: PlacementCore = {
  anchor: { lat: 55.7593, lon: 37.6452 },
  source: { center: { x: 0, y: 0 } },
  rotation: 0,
  scale: 1,
};

export const placementOf = (georeference: ManualGeoreference): PlacementCore => ({
  anchor: georeference.anchor_wgs84,
  source: { center: georeference.anchor_drawing },
  rotation: georeference.rotation_deg,
  scale: georeference.scale,
});

// Рамка опорной точки считается один раз на ответ, а не на каждую вершину.
function toLonLat(placement: PlacementCore): (point: Point) => number[] {
  const { toLatLon } = placementTransform(placement);
  return ([x, y]) => {
    const { lat, lon } = toLatLon({ x, y });
    return [lon, lat];
  };
}

const GEOGRAPHIC_CRS = 'EPSG:4326 (WGS84 lon/lat)';
const DRAWING_CRS = 'local drawing coordinates, no geo-reference available';

// null — без геопривязки: координаты отдаются в метрах чертежа, как у бэкенда.
const projector = (placement: PlacementCore | null): ((point: Point) => number[]) =>
  placement === null ? (point) => [point[0], point[1]] : toLonLat(placement);

type SiteObstacle = {
  // Норма из norms.ts без суффикса типа посадки; null — у бэкенда нормы нет, отступ
  // не строится.
  normId: string | null;
  obstacle: { category: string; subtype: string | null };
  shape: Shape;
  // Как в parsed.geojson бэкенда (../backend/greenplan/export/geojson.py:20-47): правило
  // распознавания из rules/default.yaml, слой, тип сущности и handle.
  source: { ruleId: string; status: string; layer: string; dxftype: string; handle: string };
};

const OBSTACLES: SiteObstacle[] = [
  {
    normId: '743-pp-road-edge',
    obstacle: { category: 'road_edge', subtype: null },
    shape: { kind: 'segment', from: [0, 0], to: [60, 0] },
    source: {
      ruleId: '5',
      status: 'proxy_low_confidence',
      layer: 'Бортовой камень',
      dxftype: 'LWPOLYLINE',
      handle: '2A1',
    },
  },
  {
    normId: '743-pp-power-cable',
    obstacle: { category: 'underground_utilities', subtype: 'power_cable' },
    shape: { kind: 'segment', from: [0, 4.5], to: [60, 4.5] },
    source: {
      ruleId: '3',
      status: 'auto',
      layer: 'Кабель электроснабжения',
      dxftype: 'LWPOLYLINE',
      handle: '2B4',
    },
  },
  {
    normId: '743-pp-gas',
    obstacle: { category: 'underground_utilities', subtype: 'gas' },
    shape: { kind: 'segment', from: [0, 12], to: [60, 12] },
    source: {
      ruleId: '3',
      status: 'auto',
      layer: 'Газопровод',
      dxftype: 'LWPOLYLINE',
      handle: '2C7',
    },
  },
  {
    normId: '743-pp-water',
    obstacle: { category: 'underground_utilities', subtype: 'water' },
    shape: { kind: 'segment', from: [28, 0], to: [28, 20] },
    source: {
      ruleId: '3',
      status: 'auto',
      layer: 'Водопровод',
      dxftype: 'LINE',
      handle: '2D0',
    },
  },
  {
    normId: '743-pp-existing-tree',
    obstacle: { category: 'green_existing', subtype: 'existing_tree' },
    shape: { kind: 'point', at: [48, 16] },
    source: {
      ruleId: '7',
      status: 'auto',
      layer: 'Дендроплан',
      dxftype: 'INSERT',
      handle: '31E',
    },
  },
  {
    normId: '743-pp-building',
    obstacle: { category: 'buildings', subtype: null },
    shape: {
      kind: 'polygon',
      ring: [
        [8, 23],
        [24, 23],
        [24, 31],
        [8, 31],
        [8, 23],
      ],
    },
    source: {
      ruleId: '4',
      status: 'auto',
      layer: 'Здания',
      dxftype: 'LWPOLYLINE',
      handle: '1F3',
    },
  },
  {
    normId: '743-pp-footpath-edge',
    obstacle: { category: 'footpath_edge', subtype: null },
    shape: { kind: 'segment', from: [0, -1.5], to: [60, -1.5] },
    source: {
      ruleId: '6',
      status: 'no_default_source',
      layer: 'Тротуар',
      dxftype: 'LWPOLYLINE',
      handle: '2A5',
    },
  },
  {
    normId: null,
    obstacle: { category: 'wells_hatches', subtype: null },
    shape: { kind: 'point', at: [14, 17] },
    source: {
      ruleId: '12',
      status: 'auto',
      layer: 'Колодцы',
      dxftype: 'INSERT',
      handle: '33A',
    },
  },
];

type Norm = (typeof NORMS)[number];
type NormedObstacle = SiteObstacle & { norms: Record<PlantType, Norm> };

// Препятствия с нормой — от них строятся зоны и проверки. У нормы две записи: для дерева
// и для кустарника (id с суффиксом типа посадки).
const NORMED: NormedObstacle[] = OBSTACLES.flatMap((obstacle) => {
  const normOf = (plantType: PlantType) =>
    NORMS.find(({ id }) => id === `${String(obstacle.normId)}-${plantType}`);
  const tree = normOf('tree');
  const shrub = normOf('shrub');
  return tree === undefined || shrub === undefined ? [] : [{ ...obstacle, norms: { tree, shrub } }];
});

// Категории без нормы: как у бэкенда, отступ от них не строился
// (../backend/greenplan/zoning/engine.py:158-168).
const UNCOVERED_CATEGORIES = OBSTACLES.filter(({ normId }) => normId === null).map(
  ({ obstacle }) => obstacle,
);

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

// Расстояние до препятствия — теми же функциями, что проверки на фронте (shared/lib/geometry):
// отрезок — вырожденное кольцо из двух вершин, многоугольник — кольцо.
function distance(point: Point, shape: Shape): number {
  switch (shape.kind) {
    case 'point':
      return Math.hypot(point[0] - shape.at[0], point[1] - shape.at[1]);
    case 'segment':
      return nearestOnBoundary(point, [[[shape.from, shape.to]]])?.distance ?? Infinity;
    case 'polygon':
      return isInside(point, [[shape.ring]])
        ? 0
        : (nearestOnBoundary(point, [[shape.ring]])?.distance ?? Infinity);
    default: {
      const unexpected: never = shape;
      return unexpected;
    }
  }
}

const round = (value: number, digits: number): number => Number(value.toFixed(digits));

type MeasuredCheck = { check: ExplanationCheck; violated: boolean };

// Проверки посадки — по одной на каждое препятствие с нормой, как checks в контракте. Нарушение
// решается по точному расстоянию, как у раскладки; округляется только выводимое actual_m.
function checksAt(point: Point, plantType: PlantType): MeasuredCheck[] {
  return NORMED.map(({ norms, obstacle, shape }) => {
    const norm = norms[plantType];
    const actual = distance(point, shape);
    const required = norm.distance_m;
    return {
      check: {
        category: obstacle.category,
        subtype: obstacle.subtype,
        required_m: required,
        actual_m: round(actual, 2),
        citation: norm.citation,
        norm_id: norm.id,
      },
      violated: actual < required,
    };
  });
}

// Раскладка бэкенда ставит посадку, только если её точка вне всех буферов
// (../backend/greenplan/layout/engine.py:71,103).
const violatesSetback = (point: Point, plantType: PlantType): boolean =>
  NORMED.some(({ norms, shape }) => distance(point, shape) < norms[plantType].distance_m);

const insideRect = ([x, y]: Point, rect: Rect): boolean =>
  x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2;

const boundsOf = (shape: Shape, buffer: number): Rect => {
  const points =
    shape.kind === 'point'
      ? [shape.at]
      : shape.kind === 'segment'
        ? [shape.from, shape.to]
        : shape.ring;
  return {
    x1: Math.min(...points.map(([x]) => x)) - buffer,
    y1: Math.min(...points.map(([, y]) => y)) - buffer,
    x2: Math.max(...points.map(([x]) => x)) + buffer,
    y2: Math.max(...points.map(([, y]) => y)) + buffer,
  };
};

const consecutivePairs = (values: number[]): [number, number][] =>
  values.flatMap((start, index) => {
    const end = values[index + 1];
    return end === undefined ? [] : [[start, end] as [number, number]];
  });

// Разность прямоугольников через сетку по всем их кромкам. Буфер вокруг дерева вычитается
// описанным квадратом: разрешённая зона выходит чуть меньше настоящей, для мока это допустимо.
function subtract(base: Rect, holes: Rect[]): Rect[] {
  // Кромки дыр вне основы (здание и тротуар за газоном) сетку не продолжают.
  const edges = (pick: (rect: Rect) => number[], min: number, max: number) =>
    [...new Set([base, ...holes].flatMap(pick))]
      .filter((edge) => edge >= min && edge <= max)
      .sort((a, b) => a - b);
  const columns = consecutivePairs(edges((rect) => [rect.x1, rect.x2], base.x1, base.x2));
  const rows = consecutivePairs(edges((rect) => [rect.y1, rect.y2], base.y1, base.y2));

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

// Дуга буфера — 16 отрезков на полуокружность, как у shapely.buffer по умолчанию
// (quad_segs=8), которым бэкенд строит зоны (../backend/greenplan/zoning/engine.py:131).
const ARC_STEPS = 16;

const arc = ([cx, cy]: Point, radius: number, from: number, steps: number): Point[] =>
  range(0, steps, 1).map((step) => {
    const angle = from - (step / ARC_STEPS) * Math.PI;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)] as const;
  });

// Буфер со скруглёнными концами: у точки — круг, у отрезка — «стадион», у выпуклого
// многоугольника — он же со скруглёнными углами.
function bufferOf(shape: Shape, radius: number): Point[] {
  switch (shape.kind) {
    case 'point':
      return arc(shape.at, radius, 0, 2 * ARC_STEPS - 1);
    case 'segment': {
      const [ax, ay] = shape.from;
      const [bx, by] = shape.to;
      // Направление нормали к отрезку: от неё дуга у конца обходит его через продолжение.
      const normal = Math.atan2(bx - ax, -(by - ay));
      return [
        ...arc(shape.to, radius, normal, ARC_STEPS),
        ...arc(shape.from, radius, normal - Math.PI, ARC_STEPS),
      ];
    }
    case 'polygon': {
      // Выпуклый многоугольник (здание): стороны, сдвинутые наружу, и дуги в углах — как буфер
      // shapely. Обход по часовой, как у дуг выше.
      const open = shape.ring.slice(0, -1);
      const area = open.reduce((sum, [x, y], index) => {
        const [nx, ny] = open[(index + 1) % open.length] ?? [x, y];
        return sum + x * ny - nx * y;
      }, 0);
      const ring = area > 0 ? [...open].reverse() : open;
      // Внешняя нормаль ребра при обходе по часовой.
      const normal = ([ax, ay]: Point, [bx, by]: Point) => Math.atan2(bx - ax, -(by - ay));
      return ring.flatMap((vertex, index) => {
        const previous = ring[(index + ring.length - 1) % ring.length] ?? vertex;
        const next = ring[(index + 1) % ring.length] ?? vertex;
        const from = normal(previous, vertex);
        const turn = (from - normal(vertex, next) + 2 * Math.PI) % (2 * Math.PI);
        return arc(vertex, radius, from, Math.round((turn / Math.PI) * ARC_STEPS));
      });
    }
    default: {
      const unexpected: never = shape;
      return unexpected;
    }
  }
}

// Выпуклый многоугольник, обрезанный прямоугольником (Сазерленд — Ходжмен).
function clipToRect(points: Point[], rect: Rect): Point[] {
  const edges: [(point: Point) => boolean, (a: Point, b: Point) => Point][] = [
    [([x]) => x >= rect.x1, (a, b) => crossX(a, b, rect.x1)],
    [([x]) => x <= rect.x2, (a, b) => crossX(a, b, rect.x2)],
    [([, y]) => y >= rect.y1, (a, b) => crossY(a, b, rect.y1)],
    [([, y]) => y <= rect.y2, (a, b) => crossY(a, b, rect.y2)],
  ];
  return edges.reduce<Point[]>(
    (polygon, [inside, cross]) =>
      polygon.flatMap((current, index) => {
        const previous = polygon[(index + polygon.length - 1) % polygon.length] ?? current;
        if (inside(current)) {
          return inside(previous) ? [current] : [cross(previous, current), current];
        }
        return inside(previous) ? [cross(previous, current)] : [];
      }),
    points,
  );
}

const crossX = ([ax, ay]: Point, [bx, by]: Point, x: number): Point => [
  x,
  ay + ((by - ay) * (x - ax)) / (bx - ax),
];
const crossY = ([ax, ay]: Point, [bx, by]: Point, y: number): Point => [
  ax + ((bx - ax) * (y - ay)) / (by - ay),
  y,
];

type Project = (point: Point) => number[];

const closedRing = (points: Point[], project: Project): number[][] =>
  [...points, ...points.slice(0, 1)].map(project);

const rectPoints = ({ x1, y1, x2, y2 }: Rect): Point[] => [
  [x1, y1],
  [x2, y1],
  [x2, y2],
  [x1, y2],
];

function buildZones(plantTypes: readonly PlantType[], project: Project): ZoneFeature[] {
  const polygon = (rect: Rect): ZoneFeature['geometry'] => ({
    type: 'Polygon',
    coordinates: [closedRing(rectPoints(rect), project)],
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
        NORMED.map(({ norms, shape }) => boundsOf(shape, norms[plantType].distance_m)),
      ).map((rect) => [closedRing(rectPoints(rect), project)]),
    },
    properties: { zone_type: 'allowed', plant_type: plantType },
  }));

  const prohibited: ZoneFeature[] = plantTypes.flatMap((plantType) =>
    NORMED.flatMap(({ norms, obstacle, shape }) => {
      const norm = norms[plantType];
      const buffer = norm.distance_m;
      // Как у бэкенда: буфер препятствия, обрезанный допустимой областью base_area
      // (zoning/engine.py:135); в моке она совпадает с газоном.
      const clipped = clipToRect(bufferOf(shape, buffer), LAWN);
      if (clipped.length < 3) return [];
      return [
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [closedRing(clipped, project)] },
          // Формат citation и reason — как у бэкенда: ../backend/greenplan/zoning/engine.py:141-151.
          properties: {
            zone_type: 'prohibited',
            plant_type: plantType,
            obstacle_category: obstacle.category,
            obstacle_subtype: obstacle.subtype,
            distance_m: buffer,
            citation: norm.citation,
            reason: `< ${String(buffer)} м от объекта типа «${obstacle.subtype ?? obstacle.category}»`,
          },
        } satisfies ZoneFeature,
      ];
    }),
  );

  return [...extents, ...allowed, ...prohibited];
}

function obstacleGeometry(shape: Shape, project: Project): Schemas['ObstacleFeature']['geometry'] {
  switch (shape.kind) {
    case 'point':
      return { type: 'Point', coordinates: project(shape.at) };
    case 'segment':
      return { type: 'LineString', coordinates: [project(shape.from), project(shape.to)] };
    case 'polygon':
      return { type: 'Polygon', coordinates: [shape.ring.map(project)] };
    default: {
      const unexpected: never = shape;
      return unexpected;
    }
  }
}

// Отклонённых мест в ответе — не больше этого: на крупном участке их тысячи, демо показывает
// характерные.
const MAX_REJECTED = 15;

type Placed = { id: string; plantType: PlantType; ruleId: string; ruleName: string; point: Point };
type Rejected = { plantType: PlantType; ruleId: string; point: Point };

export function buildSiteResult(params: RunParams, placement: PlacementCore | null): SiteResult {
  const placed: Placed[] = [];
  const rejected: Rejected[] = [];

  for (const [ruleId, rule] of Object.entries(params.rules)) {
    const defaults = processingDefaults.planting_rules[ruleId];
    const candidates = CANDIDATES[ruleId];
    if (defaults === undefined || candidates === undefined) continue;
    const plantType = defaults.plant_type;
    if (!params.plantTypes.includes(plantType)) continue;

    for (const point of candidates(rule.spacing, rule.offset)) {
      if (violatesSetback(point, plantType)) {
        // Как в контракте /rejected: только кандидаты в допустимой области, отклонённые по норме.
        if (insideRect(point, LAWN)) rejected.push({ plantType, ruleId, point });
        continue;
      }
      placed.push({
        id: `${ruleId}-${String(placed.length + 1).padStart(5, '0')}`,
        plantType,
        ruleId,
        ruleName: defaults.name_ru,
        point,
      });
    }
  }

  const project: Project = projector(placement);
  const crs = placement === null ? DRAWING_CRS : GEOGRAPHIC_CRS;

  return {
    explanation: placed.map(({ id, plantType, ruleId, ruleName, point }) => ({
      id,
      plant_type: plantType,
      rule_id: ruleId,
      rule_name_ru: ruleName,
      x: round(point[0], 2),
      y: round(point[1], 2),
      checks: checksAt(point, plantType).map(({ check }) => check),
    })),
    zones: {
      type: 'FeatureCollection',
      metadata: { crs, used_site_boundary: true, uncovered_categories: UNCOVERED_CATEGORIES },
      features: buildZones(params.plantTypes, project),
    },
    planting: {
      type: 'FeatureCollection',
      metadata: { crs },
      features: placed.map(({ id, plantType, ruleId, point }, index) => {
        const species = chooseSpecies(plantType, ruleId, params, index);
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: project(point) },
          properties: {
            id,
            plant_type: plantType,
            rule_id: ruleId,
            species_id: species.id,
            species_reason_ru: species.reason,
          },
        };
      }),
    },
    obstacles: {
      type: 'FeatureCollection',
      metadata: { crs, source_insunits: 6, scale_to_meters: 1 },
      features: [
        ...OBSTACLES.map(({ obstacle, shape, source }) => ({
          type: 'Feature' as const,
          geometry: obstacleGeometry(shape, project),
          properties: {
            rule_id: source.ruleId,
            category: obstacle.category,
            subtype: obstacle.subtype,
            status: source.status,
            layer: source.layer,
            dxftype: source.dxftype,
            handle: source.handle,
          },
        })),
        // Граница работ — тоже объект подосновы (правило «1» в rules/default.yaml бэкенда). Норм
        // от неё нет; по ней модуль геопривязки берёт контур проекта, упавшего на геопривязке.
        {
          type: 'Feature' as const,
          geometry: {
            type: 'Polygon' as const,
            coordinates: [closedRing(rectPoints(SITE_BOUNDARY), project)],
          },
          properties: {
            rule_id: '1',
            category: 'site_boundary',
            subtype: null,
            status: 'auto',
            layer: 'Границы_работ',
            dxftype: 'LWPOLYLINE',
            handle: '2A0',
          },
        },
      ],
    },
    rejected: {
      type: 'FeatureCollection',
      metadata: { crs },
      features: rejected.slice(0, MAX_REJECTED).map(({ plantType, ruleId, point }) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: project(point) },
        properties: {
          plant_type: plantType,
          rule_id: ruleId,
          failed_checks: checksAt(point, plantType)
            .filter(({ violated }) => violated)
            .map(({ check }) => check),
        },
      })),
    },
  };
}

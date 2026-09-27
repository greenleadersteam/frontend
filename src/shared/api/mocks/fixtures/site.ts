import { formatMeters } from '@/shared/lib/format';
import { metersPerDegree } from '@/shared/lib/geodesy';
import { isInside, type LocalPoint, nearestOnBoundary } from '@/shared/lib/geometry';

import type { components } from '../../generated/proposed';
import { NORMS } from './norms';
import { processingDefaults } from './processing-defaults';
import { chooseSpecies } from './species';

type Schemas = components['schemas'];
type PlantType = Schemas['PlantType'];
type ZoneFeature = Schemas['ZoneFeature'];
type ExplanationCheck = Schemas['ExplanationCheck'];
type ManualGeoreference = Schemas['ManualGeoreference'];
type EditedPlanting = Schemas['EditedPlanting'];
type CheckedPlanting = Schemas['CheckedPlanting'];

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
// PUT /georeference: поворот от истинного севера против часовой, масштаб. Метры в градусы —
// теми же рядами эллипсоида WGS84, что в entities/project/lib/local-frame.ts: иначе «Покровка»
// и «Шаболовка» (те же метры без геопривязки) расходились бы в расстояниях.
export type Placement = {
  anchorWgs84: { lat: number; lon: number };
  anchorDrawing: Point;
  rotationDeg: number;
  scale: number;
};

// Участок на Покровке: так его привязывает bbox_user демо-проекта.
export const DEFAULT_PLACEMENT: Placement = {
  anchorWgs84: { lat: 55.7593, lon: 37.6452 },
  anchorDrawing: [0, 0],
  rotationDeg: 0,
  scale: 1,
};

export const placementOf = (georeference: ManualGeoreference): Placement => ({
  anchorWgs84: georeference.anchor_wgs84,
  anchorDrawing: [georeference.anchor_drawing.x, georeference.anchor_drawing.y],
  rotationDeg: georeference.rotation_deg,
  scale: georeference.scale,
});

function toLonLat({ anchorWgs84, anchorDrawing, rotationDeg, scale }: Placement, [x, y]: Point) {
  const angle = (rotationDeg * Math.PI) / 180;
  const dx = (x - anchorDrawing[0]) * scale;
  const dy = (y - anchorDrawing[1]) * scale;
  const east = dx * Math.cos(angle) - dy * Math.sin(angle);
  const north = dx * Math.sin(angle) + dy * Math.cos(angle);
  const perDegree = metersPerDegree(anchorWgs84.lat);
  return [anchorWgs84.lon + east / perDegree.lon, anchorWgs84.lat + north / perDegree.lat];
}

function fromLonLat(
  { anchorWgs84, anchorDrawing, rotationDeg, scale }: Placement,
  [lon, lat]: Point,
) {
  const angle = (rotationDeg * Math.PI) / 180;
  const perDegree = metersPerDegree(anchorWgs84.lat);
  const east = (lon - anchorWgs84.lon) * perDegree.lon;
  const north = (lat - anchorWgs84.lat) * perDegree.lat;
  const dx = east * Math.cos(angle) + north * Math.sin(angle);
  const dy = -east * Math.sin(angle) + north * Math.cos(angle);
  return [anchorDrawing[0] + dx / scale, anchorDrawing[1] + dy / scale] as const;
}

const GEOGRAPHIC_CRS = 'EPSG:4326 (WGS84 lon/lat)';
const DRAWING_CRS = 'local drawing coordinates, no geo-reference available';

// null — без геопривязки: координаты отдаются в метрах чертежа, как у бэкенда.
const projectPoint = (placement: Placement | null, point: Point): number[] =>
  placement === null ? [point[0], point[1]] : toLonLat(placement, point);

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
    normId: null,
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
    normId: null,
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

// Дуга буфера — 16 отрезков на полуокружность, как у shapely.buffer по умолчанию
// (quad_segs=8), которым бэкенд строит зоны (../backend/greenplan/zoning/engine.py:131).
const ARC_STEPS = 16;

const arc = ([cx, cy]: Point, radius: number, from: number, steps: number): Point[] =>
  range(0, steps, 1).map((step) => {
    const angle = from - (step / ARC_STEPS) * Math.PI;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)] as const;
  });

// Буфер со скруглёнными концами: у точки — круг, у отрезка — «стадион». Многоугольников среди
// нормированных препятствий мока нет.
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
    case 'polygon':
      throw new Error('Буфер многоугольника в моке не нужен');
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

export function buildSiteResult(params: RunParams, placement: Placement | null): SiteResult {
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

  const project: Project = (point) => projectPoint(placement, point);
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
      features: OBSTACLES.map(({ obstacle, shape, source }) => ({
        type: 'Feature',
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

// Наименьший шаг правил этой обработки для типа посадки: ближе к соседней посадке того же
// типа сервис посадку не поставил бы (../backend/greenplan/layout/engine.py:74-77). У правки
// нет правила посадки, поэтому берётся наименьший шаг — самое мягкое из требований.
const minSpacing = (params: RunParams, plantType: PlantType): number =>
  Math.min(
    ...Object.entries(params.rules)
      .filter(([ruleId]) => processingDefaults.planting_rules[ruleId]?.plant_type === plantType)
      .map(([, rule]) => rule.spacing),
  );

// Перепроверка правок, как в контракте PUT /plantings: сначала нормы, потом допустимая область
// и шаг. Координаты — в системе ответа /planting.
export function checkPlantings(
  plantings: EditedPlanting[],
  placement: Placement | null,
  params: RunParams,
  original: readonly Schemas['PlantingFeature'][],
): CheckedPlanting[] {
  const originalPoints = new Map(
    original.map(({ geometry, properties }) => [properties.id, geometry.coordinates]),
  );
  // Посадку сервиса, которую не двигали (тот же id, та же точка), раскладка уже поставила
  // с учётом области и шага; перепроверяются только нормы.
  const unchanged = ({ geometry, properties }: EditedPlanting) => {
    const [x, y] = originalPoints.get(properties.id) ?? [];
    return (
      properties.origin === 'auto' && x === geometry.coordinates[0] && y === geometry.coordinates[1]
    );
  };
  const local = plantings.map(({ geometry }) => {
    const [x = 0, y = 0] = geometry.coordinates;
    return placement === null ? ([x, y] as const) : fromLonLat(placement, [x, y]);
  });

  return plantings.map((planting, index) => {
    const point = local[index] ?? ([0, 0] as const);
    const { plant_type: plantType } = planting.properties;
    const measured = checksAt(point, plantType);
    const base = { ...planting.properties, checks: measured.map(({ check }) => check) };

    if (measured.some(({ violated }) => violated)) {
      return { ...planting, properties: { ...base, status: 'forbidden', rejection: null } };
    }
    if (unchanged(planting)) {
      return { ...planting, properties: { ...base, status: 'allowed', rejection: null } };
    }
    if (!insideRect(point, LAWN)) {
      return {
        ...planting,
        properties: {
          ...base,
          status: 'rejected',
          rejection: {
            reason: 'outside_site',
            text_ru: 'Точка вне газона в границе участка',
            neighbour_id: null,
          },
        },
      };
    }
    const spacing = minSpacing(params, plantType);
    const neighbour = plantings
      .map((other, otherIndex) => ({ other, at: local[otherIndex] ?? point }))
      .filter(({ other }) => other !== planting && other.properties.plant_type === plantType)
      .map(({ other, at }) => ({ other, gap: Math.hypot(at[0] - point[0], at[1] - point[1]) }))
      .filter(({ gap }) => gap < spacing)
      .sort((a, b) => a.gap - b.gap)[0];
    if (neighbour !== undefined) {
      return {
        ...planting,
        properties: {
          ...base,
          status: 'rejected',
          rejection: {
            reason: 'spacing',
            text_ru: `До соседней посадки ${formatMeters(neighbour.gap, 1)} при шаге ${formatMeters(spacing, 1)}`,
            neighbour_id: neighbour.other.properties.id,
          },
        },
      };
    }
    return { ...planting, properties: { ...base, status: 'allowed', rejection: null } };
  });
}

// Координаты посадок для DXF — в метрах чертежа, как пишет ../backend/greenplan/io/dxf_sink.py.
export function drawingPoints(
  plantings: { coordinates: number[]; plantType: PlantType }[],
  placement: Placement | null,
): { point: Point; plantType: PlantType }[] {
  return plantings.map(({ coordinates: [x = 0, y = 0], plantType }) => ({
    point: placement === null ? ([x, y] as const) : fromLonLat(placement, [x, y]),
    plantType,
  }));
}

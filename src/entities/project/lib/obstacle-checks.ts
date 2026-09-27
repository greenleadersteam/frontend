import {
  isInside,
  type LocalPoint,
  type LocalPolygon,
  type Nearest,
  nearestOnSegment,
} from '@/shared/lib/geometry';

import type {
  ExplanationEntry,
  Norm,
  ObstaclesFeatureCollection,
  ZonesFeatureCollection,
} from '../api/project-result-api';
import type { PlantType } from '../model/project';
import type { LocalFrame } from './local-frame';
import type { Position } from './plan-projection';
import { type PlantingCheck, TOLERANCE_M } from './planting-checks';

type ObstacleFeature = ObstaclesFeatureCollection['features'][number];
type ServerCheck = NonNullable<ExplanationEntry['checks']>[number];

export type PreparedObstacle = {
  // Порядковый номер в /obstacles: по нему объект выделяется на карте (feature-state).
  index: number;
  properties: ObstacleFeature['properties'];
  // Ломаные в локальных метрах: линии и контуры многоугольников; точка — отрезок нулевой длины.
  lines: LocalPoint[][];
  // Посадка внутри многоугольника (здания) стоит от него на нуле.
  polygons: LocalPolygon[];
};

// Норма отступа для пары «объект + тип посадки». norm — запись /norms с актом и пунктом;
// без /norms значение и формулировка берутся из зон запрета.
export type SetbackNorm = { required: number; citation: string; norm: Norm | null };

export type PreparedObstacles = {
  obstacles: PreparedObstacle[];
  norm: (plantType: PlantType, category: string, subtype: string | null) => SetbackNorm | undefined;
  normById: (id: string) => Norm | undefined;
  // Есть справочник /norms; без него нормы — только из зон запрета, и у объекта без зоны
  // нормы в данных нет, хотя в сервисе она может быть.
  catalog: boolean;
  // Ближайшая точка каждого объекта не дальше radius: номер объекта → точка и расстояние.
  nearest: (point: LocalPoint, radius: number) => Map<number, Nearest>;
  // Порог отбора, как у зон: тройная наибольшая норма для типа посадки.
  threshold: Record<PlantType, number>;
};

// Ячейка индекса отрезков: порядка нормы, чтобы запрос смотрел десятки ячеек, а не сотни.
const CELL_M = 5;
// Расхождение своего расчёта с серверным больше 5 см — ошибка в одной из реализаций.
const DISCREPANCY_M = 0.05;

function shapesOf(
  geometry: ObstacleFeature['geometry'],
  frame: LocalFrame,
): Pick<PreparedObstacle, 'lines' | 'polygons'> {
  const local = (line: Position[]) => line.map((position) => frame.toLocal(position));
  switch (geometry.type) {
    case 'Point': {
      const point = frame.toLocal(geometry.coordinates);
      return { lines: [[point, point]], polygons: [] };
    }
    case 'LineString':
      return { lines: [local(geometry.coordinates)], polygons: [] };
    case 'MultiLineString':
      return { lines: geometry.coordinates.map(local), polygons: [] };
    case 'Polygon': {
      const polygon = geometry.coordinates.map(local);
      return { lines: polygon, polygons: [polygon] };
    }
    case 'MultiPolygon': {
      const polygons = geometry.coordinates.map((polygon) => polygon.map(local));
      return { lines: polygons.flat(), polygons };
    }
    default: {
      const unexpected: never = geometry;
      return unexpected;
    }
  }
}

type Segment = { obstacle: number; a: LocalPoint; b: LocalPoint };

// Сетка отрезков: отрезок заносится в ячейки своих точек с шагом в ячейку, поэтому любая его
// точка не дальше полуячейки от занесённой. Запрос расширяет круг на ячейку и не теряет отрезков.
function segmentIndex(obstacles: PreparedObstacle[]): PreparedObstacles['nearest'] {
  const cells = new Map<string, Segment[]>();
  const cellOf = (value: number) => Math.floor(value / CELL_M);
  const keyOf = (column: number, row: number) => `${String(column)}:${String(row)}`;
  for (const { index, lines } of obstacles) {
    for (const line of lines) {
      for (let vertex = 1; vertex < line.length; vertex += 1) {
        const a = line[vertex - 1];
        const b = line[vertex];
        if (a === undefined || b === undefined) continue;
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / CELL_M));
        const keys = new Set<string>();
        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps;
          keys.add(keyOf(cellOf(a[0] + t * (b[0] - a[0])), cellOf(a[1] + t * (b[1] - a[1]))));
        }
        for (const key of keys) {
          const segments = cells.get(key);
          if (segments === undefined) cells.set(key, [{ obstacle: index, a, b }]);
          else segments.push({ obstacle: index, a, b });
        }
      }
    }
  }

  return (point, radius) => {
    const found = new Map<number, Nearest>();
    const reach = radius + CELL_M;
    for (let column = cellOf(point[0] - reach); column <= cellOf(point[0] + reach); column += 1) {
      for (let row = cellOf(point[1] - reach); row <= cellOf(point[1] + reach); row += 1) {
        for (const { obstacle, a, b } of cells.get(keyOf(column, row)) ?? []) {
          const nearest = nearestOnSegment(point, a, b);
          const best = found.get(obstacle);
          if (
            nearest.distance <= radius &&
            (best === undefined || nearest.distance < best.distance)
          ) {
            found.set(obstacle, nearest);
          }
        }
      }
    }
    // Внутри здания расстояние до него — ноль. Проверяются только найденные рядом: посадка
    // внутри огромного здания дальше порога от его стен — дефект данных, который видно и так.
    for (const index of found.keys()) {
      const polygons = obstacles[index]?.polygons ?? [];
      if (polygons.length > 0 && isInside(point, polygons))
        found.set(index, { point, distance: 0 });
    }
    return found;
  };
}

const normKey = (category: string, subtype: string | null) => `${category}|${subtype ?? ''}`;

// Один раз на загрузку данных: объекты в локальных метрах, индекс отрезков и нормы. Нормы —
// из /norms; для пар, которых там нет (или без /norms), — из зон запрета: бэкенд пишет в зону
// норму, по которой строил буфер (../backend/greenplan/zoning/engine.py:141-151).
export function prepareObstacles(
  data: ObstaclesFeatureCollection,
  norms: Norm[] | null,
  zones: ZonesFeatureCollection,
  frame: LocalFrame,
): PreparedObstacles {
  const obstacles = data.features.map(({ geometry, properties }, index) => ({
    index,
    properties,
    ...shapesOf(geometry, frame),
  }));

  const setbacks: Record<PlantType, Map<string, SetbackNorm>> = {
    tree: new Map(),
    shrub: new Map(),
  };
  for (const { properties } of zones.features) {
    if (properties.zone_type !== 'prohibited') continue;
    setbacks[properties.plant_type].set(
      normKey(properties.obstacle_category, properties.obstacle_subtype),
      { required: properties.distance_m, citation: properties.citation, norm: null },
    );
  }
  for (const norm of norms ?? []) {
    setbacks[norm.plant_type].set(normKey(norm.obstacle_category, norm.obstacle_subtype), {
      required: norm.distance_m,
      citation: norm.citation,
      norm,
    });
  }
  const byId = new Map((norms ?? []).map((norm) => [norm.id, norm]));
  const maxRequired = (plantType: PlantType) =>
    Math.max(0, ...[...setbacks[plantType].values()].map(({ required }) => required));

  return {
    obstacles,
    norm: (plantType, category, subtype) => setbacks[plantType].get(normKey(category, subtype)),
    normById: (id) => byId.get(id),
    catalog: norms !== null,
    nearest: segmentIndex(obstacles),
    threshold: { tree: 3 * maxRequired('tree'), shrub: 3 * maxRequired('shrub') },
  };
}

type ObjectCheck = Extract<PlantingCheck, { kind: 'object' }>;

// Проверки посадки по геометрии объектов: для каждого подтипа с нормой — ближайший объект
// в пределах порога. Если сервер прислал checks (/explanation, возможность explanationChecks),
// они первичны: список и числа — его, свой расчёт даёт точку на объекте для размерной линии
// и сверяется с серверным.
export function checksAgainstObstacles(
  planting: LocalPoint,
  plantType: PlantType,
  serverChecks: ServerCheck[] | undefined,
  prepared: PreparedObstacles,
): ObjectCheck[] {
  const nearest = new Map<
    string,
    { obstacle: PreparedObstacle; point: LocalPoint; distance: number; setback: SetbackNorm }
  >();
  for (const [index, { point, distance }] of prepared.nearest(
    planting,
    prepared.threshold[plantType],
  )) {
    const obstacle = prepared.obstacles[index];
    if (obstacle === undefined) continue;
    const { category, subtype } = obstacle.properties;
    const setback = prepared.norm(plantType, category, subtype);
    if (setback === undefined) continue;
    const key = normKey(category, subtype);
    const current = nearest.get(key);
    if (current === undefined || distance < current.distance) {
      nearest.set(key, { obstacle, point, distance, setback });
    }
  }

  const checks: ObjectCheck[] =
    serverChecks === undefined
      ? [...nearest.values()].map(({ obstacle, point, distance, setback }) => ({
          kind: 'object',
          category: obstacle.properties.category,
          subtype: obstacle.properties.subtype,
          actual: distance,
          required: setback.required,
          citation: setback.citation,
          norm: setback.norm,
          violated: distance + TOLERANCE_M < setback.required,
          obstacle,
          planting,
          point,
        }))
      : serverChecks.map((server) => {
          const ours = nearest.get(normKey(server.category, server.subtype));
          if (
            import.meta.env.DEV &&
            ours !== undefined &&
            Math.abs(ours.distance - server.actual_m) > DISCREPANCY_M
          ) {
            // eslint-disable-next-line no-console -- сигнал разработчику о расхождении реализаций, только в dev
            console.warn(
              `Расстояние до ${normKey(server.category, server.subtype)}: сервер ${String(server.actual_m)} м, клиент ${ours.distance.toFixed(3)} м`,
            );
          }
          return {
            kind: 'object',
            category: server.category,
            subtype: server.subtype,
            actual: server.actual_m,
            required: server.required_m,
            citation: server.citation,
            norm:
              (server.norm_id === undefined ? undefined : prepared.normById(server.norm_id)) ??
              ours?.setback.norm ??
              null,
            violated: server.actual_m < server.required_m,
            obstacle: ours?.obstacle ?? null,
            planting,
            point: ours?.point ?? null,
          };
        });
  return checks.sort((a, b) => a.actual - a.required - (b.actual - b.required));
}

import { formatMeters } from '@/shared/lib/format';
import type { LocalPoint } from '@/shared/lib/geometry';

import type { LocalFrame } from './local-frame';
import type { PlantingCheck } from './planting-checks';

// На карте — не больше трёх ближайших ограничений: больше линий у одной посадки не читается.
const MAX_DIMENSIONS = 3;

// Засечка — короткий штрих поперёк линии, как на чертеже: 0,6 м на местности, но не короче
// 8 пикселей на мелком масштабе.
const TICK_M = 0.6;
const TICK_MIN_PX = 8;
// Подпись не ложится на крону: её точка — не ближе края кроны плюс полширины подписи
// «0,3 м» (12px Mulish — около 30px).
const LABEL_CLEARANCE_PX = 20;
// Подпись нормы — сбоку от её штриха, за его концом; под кроной — ещё и дальше вдоль отрезка.
const NORM_LABEL_GAP_PX = 14;

// По зонам: «запас» до края зоны и «охранная зона» до препятствия. По объектам: «расстояние»
// до линии объекта и отметка «норма» на том же отрезке.
type DimensionPart = 'margin' | 'setback' | 'distance' | 'norm';
type DimensionEmphasis = 'focus' | 'dim' | 'normal';

type DimensionProperties = {
  kind: 'line' | 'tick' | 'label';
  part: DimensionPart;
  // Номер проверки в списке — связь линии с элементом списка при наведении.
  check: number;
  emphasis: DimensionEmphasis;
  text?: string;
};

type Options = {
  // Ограничение под курсором или в фокусе списка: его линия толще, остальные бледнее.
  focused: number | null;
  // Метров в пикселе на текущем масштабе: для минимальной длины засечки и отступа подписи.
  metersPerPixel: number;
  // Радиус кроны выбранной посадки на карте, м.
  crownRadiusM: number;
};

type Feature = GeoJSON.Feature<GeoJSON.LineString | GeoJSON.Point, DimensionProperties>;

// Отрезок от посадки: to — его конец, length — длина по геометрии.
type Drawn =
  | {
      kind: 'zone';
      check: Extract<PlantingCheck, { kind: 'measured' | 'boundary' }>;
      to: LocalPoint;
      length: number;
    }
  | {
      kind: 'object';
      check: Extract<PlantingCheck, { kind: 'object' }>;
      to: LocalPoint;
      length: number;
    };

// Проверки, у которых есть что показать линией: с ненулевой длиной, не «внутри зоны»; у
// проверки по объекту — с точкой на объекте (её нет, если объект назвал только сервер).
function drawable(check: PlantingCheck): Drawn | null {
  switch (check.kind) {
    case 'inside':
      return null;
    case 'measured':
    case 'boundary':
      return check.margin > 0
        ? { kind: 'zone', check, to: check.boundary, length: check.margin }
        : null;
    case 'object': {
      if (check.point === null) return null;
      const length = Math.hypot(
        check.point[0] - check.planting[0],
        check.point[1] - check.planting[1],
      );
      return length > 0 ? { kind: 'object', check, to: check.point, length } : null;
    }
    default: {
      const unexpected: never = check;
      return unexpected;
    }
  }
}

export function dimensionLines(
  checks: PlantingCheck[],
  frame: LocalFrame,
  { focused, metersPerPixel, crownRadiusM }: Options,
): GeoJSON.FeatureCollection<GeoJSON.LineString | GeoJSON.Point, DimensionProperties> {
  const halfTick = Math.max(TICK_M, TICK_MIN_PX * metersPerPixel) / 2;
  const labelClearance = crownRadiusM + LABEL_CLEARANCE_PX * metersPerPixel;
  const features: Feature[] = [];

  const drawn = checks
    .flatMap((check, index) => {
      const entry = drawable(check);
      return entry === null ? [] : [{ ...entry, index }];
    })
    .slice(0, MAX_DIMENSIONS);
  // Пункт списка без своей линии (дальний или «внутри зоны») остальные линии не гасит.
  const focusedDrawn = drawn.some(({ index }) => index === focused);
  for (const entry of drawn) {
    const { index, to, length } = entry;
    const emphasis: DimensionEmphasis = !focusedDrawn
      ? 'normal'
      : focused === index
        ? 'focus'
        : 'dim';
    const [px, py] = entry.check.planting;
    const ux = (to[0] - px) / length;
    const uy = (to[1] - py) / length;
    const along = (distance: number): LocalPoint => [px + ux * distance, py + uy * distance];
    const properties = (part: DimensionPart, kind: DimensionProperties['kind']) => ({
      kind,
      part,
      check: index,
      emphasis,
    });

    const line = (from: LocalPoint, end: LocalPoint, part: DimensionPart): Feature => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [frame.toMap(from), frame.toMap(end)] },
      properties: properties(part, 'line'),
    });
    const tick = ([x, y]: LocalPoint, part: DimensionPart): Feature => ({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          frame.toMap([x - uy * halfTick, y + ux * halfTick]),
          frame.toMap([x + uy * halfTick, y - ux * halfTick]),
        ],
      },
      properties: properties(part, 'tick'),
    });
    const text = (point: LocalPoint, part: DimensionPart, value: string): Feature => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: frame.toMap(point) },
      properties: { ...properties(part, 'label'), text: value },
    });
    // Подпись остаётся у своего отрезка. Середина под кроной — подпись сдвигается вдоль
    // отрезка за край кроны, но не дальше его конца. Весь отрезок под кроной — подпись встаёт
    // сбоку от кроны напротив середины отрезка: запас по одну сторону линии, охранная зона —
    // по другую, чтобы подписи не сталкивались. start и end — расстояния концов от посадки.
    const label = (start: number, end: number, part: DimensionPart, value: string): Feature => {
      const middle = (start + end) / 2;
      const side = part === 'setback' ? -1 : 1;
      const point: LocalPoint =
        end < labelClearance
          ? [
              px + ux * middle - uy * side * labelClearance,
              py + uy * middle + ux * side * labelClearance,
            ]
          : along(Math.max(middle, labelClearance));
      return text(point, part, value);
    };

    if (entry.kind === 'object') {
      const { check } = entry;
      features.push(
        line(check.planting, to, 'distance'),
        tick(check.planting, 'distance'),
        tick(to, 'distance'),
        label(0, length, 'distance', formatMeters(check.actual, 1)),
      );
      // Отметка нормы на том же отрезке: видны и факт, и требование. Подпись — по другую
      // сторону линии, чем подпись длины; штрих под кроной — подпись сдвигается вдоль
      // отрезка за её край, как подпись длины.
      if (check.required < check.actual && check.required < length) {
        const [nx, ny] = along(check.required);
        const gap = NORM_LABEL_GAP_PX * metersPerPixel;
        const [lx, ly] = along(Math.min(Math.max(check.required, labelClearance + gap), length));
        const offset = halfTick + gap;
        features.push(
          tick([nx, ny], 'norm'),
          text(
            [lx + uy * offset, ly - ux * offset],
            'norm',
            `норма ${formatMeters(check.required)}`,
          ),
        );
      }
      continue;
    }

    const { check } = entry;
    features.push(
      line(check.planting, to, 'margin'),
      tick(check.planting, 'margin'),
      tick(to, 'margin'),
      label(0, length, 'margin', formatMeters(length, 1)),
    );
    if (check.kind === 'measured' && check.obstacle !== null) {
      const { distance_m: setback } = check.zone.properties;
      features.push(
        line(to, check.obstacle, 'setback'),
        tick(check.obstacle, 'setback'),
        label(length, length + setback, 'setback', formatMeters(setback, 1)),
      );
    }
  }
  return { type: 'FeatureCollection', features };
}

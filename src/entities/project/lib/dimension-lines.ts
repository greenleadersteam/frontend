import { formatMeters } from '@/shared/lib/format';

import type { LocalFrame, LocalPoint } from './local-frame';
import type { PlantingCheck } from './planting-checks';

// На карте — не больше трёх ближайших ограничений: больше линий у одной посадки не читается.
const MAX_DIMENSIONS = 3;

// Засечка — короткий штрих поперёк линии, как на чертеже: 0,6 м на местности, но не короче
// 8 пикселей на мелком масштабе.
const TICK_M = 0.6;
const TICK_MIN_PX = 8;

type DimensionPart = 'margin' | 'setback';
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
  // Метров в пикселе на текущем масштабе: для минимальной длины засечки.
  metersPerPixel: number;
};

type Feature = GeoJSON.Feature<GeoJSON.LineString | GeoJSON.Point, DimensionProperties>;

type MeasuredCheck = Exclude<PlantingCheck, { kind: 'inside' }>;

// Проверки, у которых есть что показать линией: не «внутри зоны», с ненулевым запасом.
const dimensionedChecks = (checks: PlantingCheck[]) =>
  checks
    .map((check, index) => ({ check, index }))
    .filter(
      (entry): entry is { check: MeasuredCheck; index: number } =>
        entry.check.kind !== 'inside' && entry.check.margin > 0,
    )
    .slice(0, MAX_DIMENSIONS);

export function dimensionLines(
  checks: PlantingCheck[],
  frame: LocalFrame,
  { focused, metersPerPixel }: Options,
): GeoJSON.FeatureCollection<GeoJSON.LineString | GeoJSON.Point, DimensionProperties> {
  const halfTick = Math.max(TICK_M, TICK_MIN_PX * metersPerPixel) / 2;
  const features: Feature[] = [];

  const drawn = dimensionedChecks(checks);
  // Пункт списка без своей линии (дальний или «внутри зоны») остальные линии не гасит.
  const focusedDrawn = drawn.some(({ index }) => index === focused);
  for (const { check, index } of drawn) {
    const emphasis: DimensionEmphasis = !focusedDrawn
      ? 'normal'
      : focused === index
        ? 'focus'
        : 'dim';
    const [px, py] = check.planting;
    const ux = (check.boundary[0] - px) / check.margin;
    const uy = (check.boundary[1] - py) / check.margin;
    const properties = (part: DimensionPart, kind: DimensionProperties['kind']) => ({
      kind,
      part,
      check: index,
      emphasis,
    });

    const line = (from: LocalPoint, to: LocalPoint, part: DimensionPart): Feature => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [frame.toMap(from), frame.toMap(to)] },
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
    const label = (
      from: LocalPoint,
      to: LocalPoint,
      part: DimensionPart,
      length: number,
    ): Feature => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: frame.toMap([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]),
      },
      properties: { ...properties(part, 'label'), text: formatMeters(length, 1) },
    });

    features.push(
      line(check.planting, check.boundary, 'margin'),
      tick(check.planting, 'margin'),
      tick(check.boundary, 'margin'),
      label(check.planting, check.boundary, 'margin', check.margin),
    );
    if (check.kind === 'measured' && check.obstacle !== null) {
      features.push(
        line(check.boundary, check.obstacle, 'setback'),
        tick(check.obstacle, 'setback'),
        label(check.boundary, check.obstacle, 'setback', check.zone.properties.distance_m),
      );
    }
  }
  return { type: 'FeatureCollection', features };
}

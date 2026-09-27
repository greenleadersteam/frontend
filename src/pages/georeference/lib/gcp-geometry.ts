import type { FeatureCollection, LineString, MultiLineString, MultiPolygon, Point } from 'geojson';

import type { StoredReference } from '@/entities/georeference';
import { enuFrame, type LatLon } from '@/shared/lib/geodesy';
import type { GcpPair, Residual } from '@/shared/lib/georeference';

const lonLat = ({ lat, lon }: LatLon): [number, number] => [lon, lat];

export type PairProperties = {
  id: string;
  // Номер точки для подписи: слой symbol подписывает строкой.
  label: string;
  enabled: boolean;
  control: boolean;
  outlier: boolean;
};

// Точки пар на карте — место, куда оператор поставил точку карты, с номером пары.
export function pairsFeature(
  gcp: readonly GcpPair[],
  outliers: ReadonlySet<string>,
): FeatureCollection<Point, PairProperties> {
  return {
    type: 'FeatureCollection',
    features: gcp.map((pair) => ({
      type: 'Feature',
      properties: {
        id: pair.id,
        label: String(pair.n),
        enabled: pair.enabled,
        control: pair.control,
        outlier: outliers.has(pair.id),
      },
      geometry: { type: 'Point', coordinates: lonLat(pair) },
    })),
  };
}

// Резинка между точкой контура и курсором, пока пара не закончена.
export const rubberFeature = (from: LatLon, to: LatLon): FeatureCollection<LineString> => ({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [lonLat(from), lonLat(to)] },
    },
  ],
});

// Короче этого стрелка не рисуется: на экране она была бы точкой (прототип, layers.js:260).
const MIN_VECTOR_M = 0.05;
// Наконечник — 28 % длины стрелки, но не больше 14 м на местности.
const HEAD_SHARE = 0.28;
const MAX_HEAD_M = 14;
const HEAD_TURN = 0.4;

// Векторы невязок: стрелка от фактического положения точки к расчётному, увеличенная в k раз
// (прототип, ../geojson/js/layers.js:249-276). Выключенные точки не рисуются.
export function vectorsFeature(
  rows: readonly Residual[],
  k: number,
): FeatureCollection<MultiLineString, { control: boolean }> {
  if (k <= 0) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: rows.flatMap((row) => {
      if (!row.pair.enabled) return [];
      const length = Math.hypot(row.dE, row.dN) * k;
      if (length < MIN_VECTOR_M) return [];
      const frame = enuFrame({ lat: row.pair.lat, lon: row.pair.lon });
      const at = (e: number, n: number) => lonLat(frame.toGeodetic({ e, n, u: 0 }));
      const tip = at(row.dE * k, row.dN * k);
      const head = Math.min(length * HEAD_SHARE, MAX_HEAD_M);
      const angle = Math.atan2(row.dE, row.dN);
      const wing = (turn: number) => {
        const a = angle + Math.PI + turn;
        return at(row.dE * k + Math.sin(a) * head, row.dN * k + Math.cos(a) * head);
      };
      return [
        {
          type: 'Feature' as const,
          properties: { control: row.control },
          geometry: {
            type: 'MultiLineString' as const,
            coordinates: [
              [lonLat(row.pair), tip],
              [wing(HEAD_TURN), tip, wing(-HEAD_TURN)],
            ],
          },
        },
      ];
    }),
  };
}

export type ReferenceProperties = { id: string; color: string };

// Оттенок эталона — по номеру его добавления, по кругу: удаление соседа его не меняет.
export const referenceColor = (reference: StoredReference, shades: readonly string[]): string =>
  shades[(reference.seq - 1) % shades.length] ?? '';

// Эталоны — контуры в их настоящем положении.
export function referencesFeature(
  references: readonly StoredReference[],
  shades: readonly string[],
): FeatureCollection<MultiPolygon, ReferenceProperties> {
  return {
    type: 'FeatureCollection',
    features: references.flatMap((reference) =>
      reference.visible
        ? [
            {
              type: 'Feature' as const,
              properties: { id: reference.id, color: referenceColor(reference, shades) },
              geometry: {
                type: 'MultiPolygon' as const,
                coordinates: reference.polygons.map((rings) =>
                  rings.map((ring) => {
                    const points = ring.map(lonLat);
                    const first = points[0];
                    return first === undefined ? points : [...points, first];
                  }),
                ),
              },
            },
          ]
        : [],
    ),
  };
}

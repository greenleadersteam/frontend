import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  MapMouseEvent,
  PointLike,
} from 'maplibre-gl';
import { useEffect, useLayoutEffect, useRef } from 'react';

import { georeferenceActions, type StoredReference } from '@/entities/georeference';
import type { LocalPoint } from '@/shared/lib/geodesy';
import {
  frameOf,
  type GcpPair,
  type Placement,
  type Residual,
  SNAP_PX,
  type SnapKind,
  snapToContour,
  vertexLatLon,
} from '@/shared/lib/georeference';
import { useAppDispatch } from '@/shared/lib/store';
import { georeferenceColors } from '@/shared/theme';

import { MAX_DRAWN_VERTICES, pointFeature } from '../lib/contour-geometry';
import {
  pairsFeature,
  referencesFeature,
  rubberFeature,
  vectorsFeature,
} from '../lib/gcp-geometry';
import { CONTOUR_LAYER } from './contour-layers';
import { addGcpLayers, GCP_LAYER, GCP_SOURCE } from './gcp-layers';

// Первая точка пары: место на контуре в координатах файла.
export type PendingPoint = LocalPoint & { kind: SnapKind };

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

type GcpMapOptions = {
  map: MapLibreMap | null;
  placement: Placement | null;
  gcp: readonly GcpPair[];
  rows: readonly Residual[];
  outliers: ReadonlySet<string>;
  references: readonly StoredReference[];
  // Множитель векторов невязок; 0 — не показывать.
  vectorScale: number;
  active: boolean;
  pending: PendingPoint | null;
  onPending: (point: PendingPoint | null) => void;
  // Точка, наведённая в таблице или на карте.
  hot: string | null;
  onHot: (id: string | null) => void;
};

const setData = (map: MapLibreMap, source: string, data: GeoJSON.GeoJSON) => {
  void map.getSource<GeoJSONSource>(source)?.setData(data);
};

// Точка контура под курсором. Пока вершины на карте, притяжение к ним — по отрисованным точкам
// в квадрате ±12 px; без вершины рядом и у крупного контура без точек вершин — по данным:
// ближайшая вершина в 12 px или ближайшая точка ребра (прототип, gcp.js:62-111).
function snapAt(map: MapLibreMap, placement: Placement, point: LocalPoint): PendingPoint | null {
  if (placement.source.counts.vertices <= MAX_DRAWN_VERTICES) {
    const box: [PointLike, PointLike] = [
      [point.x - SNAP_PX, point.y - SNAP_PX],
      [point.x + SNAP_PX, point.y + SNAP_PX],
    ];
    let best: (PendingPoint & { distance: number }) | null = null;
    for (const feature of map.queryRenderedFeatures(box, { layers: [CONTOUR_LAYER.vertices] })) {
      const { x, y } = feature.properties;
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      const screen = map.project(lonLatOf(vertexLatLon({ x, y }, placement)));
      const distance = Math.hypot(screen.x - point.x, screen.y - point.y);
      if (distance <= SNAP_PX && (best === null || distance < best.distance)) {
        best = { x, y, kind: 'vertex', distance };
      }
    }
    if (best !== null) return { x: best.x, y: best.y, kind: best.kind };
  }
  const frame = frameOf(placement);
  const snap = snapToContour(
    placement.source,
    (local) => map.project(lonLatOf(vertexLatLon(local, placement, frame))),
    point,
  );
  return snap === null ? null : { x: snap.x, y: snap.y, kind: snap.kind };
}

const lonLatOf = ({ lat, lon }: { lat: number; lon: number }): [number, number] => [lon, lat];

// Опорные точки на карте: точки пар с номерами, векторы невязок, эталоны; в режиме расстановки —
// притяжение к контуру, резинка и пара из двух щелчков. Каждая новая пара — одно действие,
// оно же пересчёт положения и шаг истории.
export function useGcpMap(options: GcpMapOptions): void {
  const dispatch = useAppDispatch();
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const { map, gcp, rows, outliers, references, vectorScale, active, pending, hot } = options;

  useEffect(() => {
    if (map === null) return;
    addGcpLayers(map);

    const move = (event: MapMouseEvent) => {
      const { active: on, pending: first, placement: current } = latest.current;
      if (!on || current === null) return;
      if (first === null) {
        // Индикатор притяжения — только пока вершины на карте: у крупного контура поиск
        // по данным на каждое движение мыши был бы заметен; щелчок притягивает и там.
        const snap =
          current.source.counts.vertices <= MAX_DRAWN_VERTICES
            ? snapAt(map, current, event.point)
            : null;
        setData(
          map,
          GCP_SOURCE.snap,
          snap === null ? EMPTY : pointFeature(vertexLatLon(snap, current)),
        );
        return;
      }
      setData(
        map,
        GCP_SOURCE.rubber,
        rubberFeature(vertexLatLon(first, current), {
          lat: event.lngLat.lat,
          lon: event.lngLat.lng,
        }),
      );
    };

    const click = (event: MapMouseEvent) => {
      const { active: on, pending: first, placement: current, onPending } = latest.current;
      if (!on || current === null) return;
      if (first === null) {
        onPending(snapAt(map, current, event.point));
        setData(map, GCP_SOURCE.snap, EMPTY);
        return;
      }
      setData(map, GCP_SOURCE.rubber, EMPTY);
      onPending(null);
      dispatch(
        georeferenceActions.gcpAdded({
          pair: { ...first, lat: event.lngLat.lat, lon: event.lngLat.lng },
        }),
      );
    };

    const enter = (event: MapLayerMouseEvent) => {
      const id: unknown = event.features?.[0]?.properties.id;
      if (typeof id === 'string') latest.current.onHot(id);
    };
    const leave = () => {
      latest.current.onHot(null);
    };

    map.on('mousemove', move);
    map.on('click', click);
    map.on('mousemove', GCP_LAYER.pairs, enter);
    map.on('mouseleave', GCP_LAYER.pairs, leave);
    return () => {
      map.off('mousemove', move);
      map.off('click', click);
      map.off('mousemove', GCP_LAYER.pairs, enter);
      map.off('mouseleave', GCP_LAYER.pairs, leave);
    };
  }, [map, dispatch]);

  useEffect(() => {
    if (map === null) return;
    setData(map, GCP_SOURCE.pairs, pairsFeature(gcp, outliers));
    setData(map, GCP_SOURCE.vectors, vectorsFeature(rows, vectorScale));
  }, [map, gcp, rows, outliers, vectorScale]);

  useEffect(() => {
    if (map === null) return;
    setData(
      map,
      GCP_SOURCE.references,
      referencesFeature(references, georeferenceColors.references),
    );
  }, [map, references]);

  useEffect(() => {
    map?.setFilter(GCP_LAYER.pairsHot, ['==', ['get', 'id'], hot ?? '']);
  }, [map, hot]);

  // Выход из режима или отмена первой точки убирают резинку и индикатор; курсор — перекрестие.
  useEffect(() => {
    if (map === null) return;
    if (!active || pending === null) setData(map, GCP_SOURCE.rubber, EMPTY);
    if (!active || pending !== null) setData(map, GCP_SOURCE.snap, EMPTY);
    map.getCanvas().style.cursor = active ? 'crosshair' : '';
  }, [map, active, pending]);
}

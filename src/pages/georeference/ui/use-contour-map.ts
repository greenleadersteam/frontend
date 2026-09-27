import {
  type GeoJSONSource,
  type Map as MapLibreMap,
  MapMouseEvent,
  type MapTouchEvent,
  Marker,
} from 'maplibre-gl';
import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';

import { georeferenceActions } from '@/entities/georeference';
import type { LatLon, PlaneEnu } from '@/shared/lib/geodesy';
import { formatDegrees, type Placement } from '@/shared/lib/georeference';
import { useAppDispatch } from '@/shared/lib/store';

import {
  contourFeature,
  draggedAnchor,
  fitBounds,
  GESTURE_VERTEX_LIMIT,
  grabOffset,
  handlePosition,
  leverFeature,
  pointFeature,
  rotationAt,
  sectorFeature,
  thinOut,
  verticesFeature,
} from '../lib/contour-geometry';
import {
  addContourLayers,
  CONTOUR_LAYER,
  CONTOUR_LAYERS,
  CONTOUR_SOURCE,
  GRAB_LAYERS,
} from './contour-layers';
import classes from './georeference-page.module.css';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const END_EVENTS = ['mouseup', 'touchend', 'touchcancel'] as const;
// Попадание в контур — в квадрате ±4 px: в линию шириной 2 px иначе не попасть.
const GRAB_TOLERANCE_PX = 4;

type Gesture =
  | { kind: 'move'; offset: PlaneEnu; start: LatLon }
  | { kind: 'rotate'; start: number; shift: boolean };

type Live = {
  // Положение, которое сейчас на карте: во время жеста — из жеста, иначе — из Redux.
  placement: Placement | null;
  gesture: Gesture | null;
  frame: number | null;
};

type ContourMapOptions = {
  map: MapLibreMap | null;
  placement: Placement | null;
  fillOpacity: number;
  contourVisible: boolean;
  // Число у курсора во время поворота.
  readout: RefObject<HTMLDivElement | null>;
};

const setData = (map: MapLibreMap, source: string, data: GeoJSON.GeoJSON) => {
  void map.getSource<GeoJSONSource>(source)?.setData(data);
};

// Рисует положение в источники карты. Во время жеста крупный контур — прореженным, без точек
// вершин; ручку двигает мышь, поэтому её положение передаёт вызывающий.
function draw(map: MapLibreMap, placement: Placement, gesture: boolean, handle: LatLon): void {
  const polygons = gesture
    ? thinOut(placement.source.polygons, GESTURE_VERTEX_LIMIT)
    : placement.source.polygons;
  setData(map, CONTOUR_SOURCE.contour, contourFeature(placement, polygons));
  setData(map, CONTOUR_SOURCE.vertices, gesture ? EMPTY : verticesFeature(placement));
  setData(map, CONTOUR_SOURCE.anchor, pointFeature(placement.anchor));
  setData(map, CONTOUR_SOURCE.lever, leverFeature(placement.anchor, handle));
}

function clear(map: MapLibreMap): void {
  for (const source of Object.values(CONTOUR_SOURCE)) setData(map, source, EMPTY);
}

// Контур на карте: слои, ручка поворота, перетаскивание и поворот мышью и пальцем.
//
// Ни одного действия Redux на кадр жеста: пока контур тянут, положение живёт в ref, источники
// карты обновляются напрямую не чаще раза в кадр, а в Redux уходит одно действие на отпускание —
// оно же шаг истории.
export function useContourMap({
  map,
  placement,
  fillOpacity,
  contourVisible,
  readout,
}: ContourMapOptions): { fit: (target?: Placement) => void } {
  const dispatch = useAppDispatch();
  const live = useRef<Live>({ placement: null, gesture: null, frame: null });
  const marker = useRef<Marker | null>(null);
  // Параметры для обработчиков, созданных один раз на карту.
  const latest = useRef({ fillOpacity, readout });
  useLayoutEffect(() => {
    latest.current = { fillOpacity, readout };
  });

  useEffect(() => {
    if (map === null) return;
    addContourLayers(map, latest.current.fillOpacity);

    const element = document.createElement('div');
    // Индексный тип CSS-модуля допускает отсутствие ключа; класс в модуле есть.
    element.className = classes.handle ?? '';
    // Поворот с клавиатуры — Q и E; ручка — для мыши и пальца.
    element.setAttribute('aria-hidden', 'true');
    const handle = new Marker({ element, draggable: true });
    marker.current = handle;

    const state = live.current;

    const showReadout = (text: string | null, at?: { x: number; y: number }) => {
      const box = latest.current.readout.current;
      if (box === null) return;
      box.hidden = text === null;
      if (text === null || at === undefined) return;
      box.textContent = text;
      box.style.transform = `translate(${String(at.x + 14)}px, ${String(at.y + 14)}px)`;
    };

    const render = () => {
      state.frame = null;
      const current = state.placement;
      if (current === null) return;
      const rotating = state.gesture?.kind === 'rotate';
      const knob = rotating ? handle.getLngLat() : null;
      const handleAt = knob === null ? handlePosition(current) : { lat: knob.lat, lon: knob.lng };
      draw(map, current, true, handleAt);
      if (!rotating) handle.setLngLat([handleAt.lon, handleAt.lat]);
      if (state.gesture?.kind === 'rotate') {
        setData(map, CONTOUR_SOURCE.sector, sectorFeature(current, state.gesture.start));
        showReadout(
          `${formatDegrees(current.rotation, 2)}${state.gesture.shift ? ', шаг 15°' : ', Shift — шаг 15°'}`,
          map.project([handleAt.lon, handleAt.lat]),
        );
      }
    };
    const schedule = () => {
      state.frame ??= requestAnimationFrame(render);
    };

    // Жест закончен: точная форма рисуется из Redux, если положение изменилось, иначе — здесь.
    const finish = (changed: boolean) => {
      if (state.frame !== null) cancelAnimationFrame(state.frame);
      state.frame = null;
      state.gesture = null;
      setData(map, CONTOUR_SOURCE.sector, EMPTY);
      showReadout(null);
      if (changed || state.placement === null) return;
      const handleAt = handlePosition(state.placement);
      draw(map, state.placement, false, handleAt);
      handle.setLngLat([handleAt.lon, handleAt.lat]);
    };

    // Перетаскивание контура.
    const move = (event: MapMouseEvent | MapTouchEvent) => {
      const { gesture, placement: current } = state;
      if (gesture?.kind !== 'move' || current === null) return;
      const cursor = { lat: event.lngLat.lat, lon: event.lngLat.lng };
      state.placement = { ...current, anchor: draggedAnchor(gesture.offset, cursor) };
      schedule();
    };
    const end = () => {
      const { gesture, placement: current } = state;
      if (gesture?.kind !== 'move') return;
      map.off('mousemove', move);
      map.off('touchmove', move);
      for (const type of END_EVENTS) window.removeEventListener(type, end);
      map.dragPan.enable();
      const moved =
        current !== null &&
        (current.anchor.lat !== gesture.start.lat || current.anchor.lon !== gesture.start.lon);
      finish(moved);
      if (moved) dispatch(georeferenceActions.contourMoved({ anchor: current.anchor }));
    };
    const begin = (event: MapMouseEvent | MapTouchEvent) => {
      const current = state.placement;
      if (current === null || state.gesture !== null) return;
      if ('points' in event && event.points.length > 1) return;
      if ('button' in event.originalEvent && event.originalEvent.button !== 0) return;
      // Нажатие на ручку — поворот: маркер MapLibre начинает его с того же mousedown карты,
      // а контур рядом с ручкой попал бы в квадрат попадания.
      const { target } = event.originalEvent;
      if (target instanceof Node && element.contains(target)) return;
      const { x, y } = event.point;
      const hit = map.queryRenderedFeatures(
        [
          [x - GRAB_TOLERANCE_PX, y - GRAB_TOLERANCE_PX],
          [x + GRAB_TOLERANCE_PX, y + GRAB_TOLERANCE_PX],
        ],
        { layers: GRAB_LAYERS },
      );
      if (hit.length === 0) return;
      // Жест не должен двигать карту: и preventDefault, и выключенный dragPan — касание
      // MapLibre обрабатывает отдельно от мыши.
      event.preventDefault();
      map.dragPan.disable();
      const cursor = { lat: event.lngLat.lat, lon: event.lngLat.lng };
      state.gesture = {
        kind: 'move',
        offset: grabOffset(current.anchor, cursor),
        start: current.anchor,
      };
      map.on('mousemove', move);
      map.on('touchmove', move);
      // Конец жеста — на window: кнопку отпускают и над панелями, и за окном.
      for (const type of END_EVENTS) window.addEventListener(type, end);
    };

    // Поворот за ручку. Пока её тянут, её положение задаёт мышь, а не перерисовка: иначе ручка
    // пересоздавалась бы и отскакивала под курсором (ловушка прототипа).
    const trackShift = (event: KeyboardEvent | PointerEvent) => {
      if (state.gesture?.kind !== 'rotate' || state.gesture.shift === event.shiftKey) return;
      state.gesture.shift = event.shiftKey;
      rotate();
    };
    const rotate = () => {
      const { gesture, placement: current } = state;
      if (gesture?.kind !== 'rotate' || current === null) return;
      const knob = handle.getLngLat();
      const rotation = rotationAt(current.anchor, { lat: knob.lat, lon: knob.lng }, gesture.shift);
      state.placement = { ...current, rotation };
      schedule();
    };
    // Маркер MapLibre заканчивает перетаскивание по mouseup на карте. Кнопку отпустили за её
    // краем — карта mouseup не видит, и ручка «прилипала» к курсору до следующего щелчка по
    // карте. Если жест ещё идёт, когда mouseup дошёл до window, карта узнаёт о нём явно, и маркер
    // заканчивает перетаскивание сам. Касание всегда заканчивается на элементе, где началось.
    const releaseOutside = (event: MouseEvent) => {
      if (state.gesture?.kind === 'rotate') map.fire(new MapMouseEvent('mouseup', map, event));
    };
    const rotateStart = () => {
      if (state.placement === null || state.gesture !== null) return;
      state.gesture = { kind: 'rotate', start: state.placement.rotation, shift: false };
      window.addEventListener('keydown', trackShift);
      window.addEventListener('keyup', trackShift);
      window.addEventListener('pointermove', trackShift);
      window.addEventListener('mouseup', releaseOutside);
    };
    const rotateEnd = () => {
      const { gesture, placement: current } = state;
      if (gesture?.kind !== 'rotate') return;
      window.removeEventListener('keydown', trackShift);
      window.removeEventListener('keyup', trackShift);
      window.removeEventListener('pointermove', trackShift);
      window.removeEventListener('mouseup', releaseOutside);
      const changed = current !== null && current.rotation !== gesture.start;
      finish(changed);
      if (changed) dispatch(georeferenceActions.contourRotated({ rotation: current.rotation }));
    };

    map.on('mousedown', begin);
    map.on('touchstart', begin);
    handle.on('dragstart', rotateStart);
    handle.on('drag', rotate);
    handle.on('dragend', rotateEnd);
    return () => {
      end();
      rotateEnd();
      map.off('mousedown', begin);
      map.off('touchstart', begin);
      handle.remove();
      marker.current = null;
    };
  }, [map, dispatch]);

  // Положение из Redux: после загрузки, отмены, клавиш, полей и отпускания жеста.
  useEffect(() => {
    const state = live.current;
    const handle = marker.current;
    if (map === null || handle === null || state.gesture !== null) return;
    state.placement = placement;
    if (placement === null) {
      clear(map);
      handle.remove();
      return;
    }
    const handleAt = handlePosition(placement);
    draw(map, placement, false, handleAt);
    handle.setLngLat([handleAt.lon, handleAt.lat]).addTo(map);
  }, [map, placement]);

  useEffect(() => {
    map?.setPaintProperty(CONTOUR_LAYER.fill, 'fill-opacity', fillOpacity);
  }, [map, fillOpacity]);

  useEffect(() => {
    if (map === null) return;
    for (const id of CONTOUR_LAYERS) {
      map.setLayoutProperty(id, 'visibility', contourVisible ? 'visible' : 'none');
    }
    marker.current?.getElement().toggleAttribute('hidden', !contourVisible);
    // Контур тянут пальцем: жест не должен прокручивать страницу.
    map.getCanvasContainer().style.touchAction = placement === null ? '' : 'none';
  }, [map, contourVisible, placement]);

  return {
    // Без аргумента — текущее положение; только что загруженный контур передаётся явно: в Redux
    // он появится после перерисовки.
    fit: (target = placement ?? undefined) => {
      if (map === null || target === undefined) return;
      map.fitBounds(fitBounds(target), { padding: 48 });
    },
  };
}

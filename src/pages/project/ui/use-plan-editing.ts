import { useWindowEvent } from '@mantine/hooks';
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  MapLayerTouchEvent,
  MapMouseEvent,
  MapTouchEvent,
} from 'maplibre-gl';
import { useEffect, useLayoutEffect, useRef } from 'react';

import {
  CROWN_RADIUS_M,
  dimensionLines,
  editedPlantingFeatures,
  type LocalFrame,
  type PlantingCheck,
  type PlantingStatus,
  type PlantType,
  RESULT_SOURCE,
  SELECTABLE_LAYERS,
} from '@/entities/project';
import {
  type EditMode,
  manualId,
  plantingEditsActions as actions,
} from '@/features/edit-plantings';
import type { LocalPoint } from '@/shared/lib/geometry';
import { isTyping } from '@/shared/lib/keyboard';
import { useAppDispatch } from '@/shared/lib/store';

// Посадки, которые правит план: исходные с правками, в координатах данных.
type PlantingPoint = { point: readonly number[]; plantType: PlantType };

// Серия нажатий стрелок без паузы дольше этого — одна запись в истории правок.
const SERIES_PAUSE_MS = 500;
const ARROW_STEP_M = 0.1;
const ARROW_STEP_SHIFT_M = 1;

const END_EVENTS = ['mouseup', 'touchend', 'touchcancel'] as const;

// Источники, в которых посадка по её id прячется, пока её тянут.
const DRAGGED_SOURCES = [RESULT_SOURCE.planting, RESULT_SOURCE.highlights, RESULT_SOURCE.status];

type PlanEditingOptions = {
  map: MapLibreMap | null;
  projectId: string;
  mode: EditMode;
  // План на экране: в «Ведомости» он скрыт, и клавиши правки не должны его менять.
  visible: boolean;
  frame: LocalFrame;
  latitude: number;
  plantings: ReadonlyMap<string, PlantingPoint>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  // Порода по умолчанию для добавленной посадки: первая подходящая из справочника.
  defaultSpecies: (plantType: PlantType) => string | null;
  // Статус и проверки точки — теми же функциями, что у карточки.
  statusAt: (point: LocalPoint, plantType: PlantType) => PlantingStatus;
  checksAt: (point: LocalPoint, plantType: PlantType) => PlantingCheck[];
  metersPerPixel: () => number;
};

type Drag = {
  id: string;
  plantType: PlantType;
  // Смещение посадки от курсора в локальных метрах — постоянное, зафиксировано при захвате:
  // с приращениями посадка уползала бы от курсора.
  offset: LocalPoint;
  start: LocalPoint;
  current: LocalPoint;
  frame: number | null;
};

// Посадка инструмента «Добавить» в точку карты; новая посадка становится выбранной.
function placePlanting(
  { mode, frame, projectId, defaultSpecies, onSelect }: PlanEditingOptions,
  dispatch: AppDispatch,
  lngLat: readonly [number, number],
) {
  if (!mode.editing || mode.tool === 'select') return;
  const plantType = mode.tool;
  const id = manualId();
  const point = frame.toData(frame.fromMap(lngLat));
  dispatch(
    actions.added({ projectId, id, point, plantType, speciesId: defaultSpecies(plantType) }),
  );
  onSelect(id);
}

// Правка расстановки на плане: перетаскивание мышью и пальцем, добавление щелчком, стрелки
// и Delete. Во время жеста положение живёт в ref, источник «правка» обновляется напрямую
// не чаще раза в кадр, в Redux — одно действие на отпускание.
export function usePlanEditing(options: PlanEditingOptions): void {
  const dispatch = useAppDispatch();
  // Обработчики карты создаются один раз; свежие параметры — через ref, обновлённый до отрисовки.
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const series = useRef<{ key: string; at: number } | null>(null);

  const { map, mode } = options;
  const arrowsMovePlanting = mode.editing && options.selectedId !== null;

  // Стрелки двигают выбранную посадку; KeyboardHandler MapLibre слушает контейнер карты раньше
  // window и сдвинул бы ещё и камеру.
  useEffect(() => {
    if (map === null) return;
    if (arrowsMovePlanting) map.keyboard.disable();
    else map.keyboard.enable();
  }, [map, arrowsMovePlanting]);

  // Во время правки жесты пальцем не прокручивают страницу: ими тянут посадки.
  useEffect(() => {
    if (map === null) return;
    const container = map.getCanvasContainer();
    container.style.touchAction = mode.editing ? 'none' : '';
    map.getCanvas().style.cursor = mode.editing && mode.tool !== 'select' ? 'crosshair' : '';
  }, [map, mode.editing, mode.tool]);

  useEffect(() => {
    if (map === null) return;
    let drag: Drag | null = null;

    const render = () => {
      if (drag === null) return;
      drag.frame = null;
      const { frame, latitude, statusAt, checksAt, metersPerPixel } = latest.current;
      const { current, plantType } = drag;
      void map
        .getSource<GeoJSONSource>(RESULT_SOURCE.edit)
        ?.setData(
          editedPlantingFeatures(
            frame.toMap(current),
            plantType,
            statusAt(current, plantType),
            latitude,
          ),
        );
      void map.getSource<GeoJSONSource>(RESULT_SOURCE.dimensions)?.setData(
        dimensionLines(checksAt(current, plantType), frame, {
          focused: null,
          metersPerPixel: metersPerPixel(),
          crownRadiusM: CROWN_RADIUS_M[plantType],
        }),
      );
    };

    const move = (event: MapMouseEvent | MapTouchEvent) => {
      if (drag === null) return;
      const pointer = latest.current.frame.fromMap([event.lngLat.lng, event.lngLat.lat]);
      drag.current = [pointer[0] + drag.offset[0], pointer[1] + drag.offset[1]];
      drag.frame ??= requestAnimationFrame(render);
    };

    const setDragging = (id: string, dragging: boolean) => {
      for (const source of DRAGGED_SOURCES) {
        map.setFeatureState({ source, id }, { dragging });
      }
    };

    const end = () => {
      if (drag === null) return;
      const { id, start, current } = drag;
      if (drag.frame !== null) cancelAnimationFrame(drag.frame);
      drag = null;
      map.off('mousemove', move);
      map.off('touchmove', move);
      for (const type of END_EVENTS) window.removeEventListener(type, end);
      map.dragPan.enable();
      setDragging(id, false);
      void map
        .getSource<GeoJSONSource>(RESULT_SOURCE.edit)
        ?.setData({ type: 'FeatureCollection', features: [] });
      if (current[0] !== start[0] || current[1] !== start[1]) {
        dispatch(
          actions.moved({
            projectId: latest.current.projectId,
            id,
            point: latest.current.frame.toData(current),
          }),
        );
      }
    };

    const begin = (event: MapLayerMouseEvent | MapLayerTouchEvent) => {
      const { mode: current, plantings, frame, onSelect } = latest.current;
      if (!current.editing || current.tool !== 'select') return;
      const id: unknown = event.features?.[0]?.properties.id;
      const planting = typeof id === 'string' ? plantings.get(id) : undefined;
      if (typeof id !== 'string' || planting === undefined) return;
      // Жест не должен двигать карту: и preventDefault, и выключенный dragPan — касание
      // MapLibre обрабатывает отдельно от мыши.
      event.preventDefault();
      map.dragPan.disable();
      const at = frame.toLocal(planting.point);
      const pointer = frame.fromMap([event.lngLat.lng, event.lngLat.lat]);
      drag = {
        id,
        plantType: planting.plantType,
        offset: [at[0] - pointer[0], at[1] - pointer[1]],
        start: at,
        current: at,
        frame: null,
      };
      setDragging(id, true);
      onSelect(id);
      render();
      map.on('mousemove', move);
      map.on('touchmove', move);
      // Конец жеста — на window: кнопку отпускают и над панелями поверх карты, и за окном.
      for (const type of END_EVENTS) window.addEventListener(type, end);
    };

    // Добавление: щелчок по карте в режиме инструмента ставит посадку и выбирает её.
    const place = (event: MapMouseEvent) => {
      placePlanting(latest.current, dispatch, [event.lngLat.lng, event.lngLat.lat]);
    };

    for (const layer of SELECTABLE_LAYERS) {
      map.on('mousedown', layer, begin);
      map.on('touchstart', layer, begin);
    }
    map.on('click', place);
    return () => {
      for (const layer of SELECTABLE_LAYERS) {
        map.off('mousedown', layer, begin);
        map.off('touchstart', layer, begin);
      }
      map.off('click', place);
      end();
    };
  }, [map, dispatch]);

  // Esc выходит из режима добавления. Фаза захвата: фокус обычно остаётся на кнопке
  // инструмента, а её подсказка (floating-ui useDismiss) останавливает всплытие Esc.
  useWindowEvent(
    'keydown',
    (event) => {
      const { mode: current, visible } = latest.current;
      if (event.key !== 'Escape' || !visible || !current.editing || current.tool === 'select') {
        return;
      }
      if (!isTyping(event.target)) current.setTool('select');
    },
    { capture: true },
  );

  // Клавиатура правки: Enter на карте ставит посадку инструмента в центр видимой области,
  // стрелки двигают выбранную, Delete и Backspace удаляют. При скрытом плане клавиши его не
  // трогают.
  useWindowEvent('keydown', (event) => {
    const {
      mode: current,
      visible,
      selectedId,
      plantings,
      frame,
      projectId,
      onSelect,
    } = latest.current;
    if (!current.editing || !visible || isTyping(event.target)) return;
    if (event.key === 'Enter' && current.tool !== 'select' && event.target === map?.getCanvas()) {
      event.preventDefault();
      const { lng, lat } = map.getCenter();
      placePlanting(latest.current, dispatch, [lng, lat]);
      return;
    }
    // Выбор может указывать на посадку, которой уже нет: добавление отменено.
    if (selectedId === null || !plantings.has(selectedId)) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      dispatch(actions.removed({ projectId, id: selectedId }));
      onSelect(null);
      return;
    }
    const direction = {
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    }[event.key];
    const planting = plantings.get(selectedId);
    if (direction === undefined || planting === undefined) return;
    event.preventDefault();
    const step = event.shiftKey ? ARROW_STEP_SHIFT_M : ARROW_STEP_M;
    const [x, y] = frame.toLocal(planting.point);
    const now = performance.now();
    const previous = series.current;
    const key =
      previous !== null && now - previous.at < SERIES_PAUSE_MS ? previous.key : String(now);
    series.current = { key, at: now };
    dispatch(
      actions.moved({
        projectId,
        id: selectedId,
        point: frame.toData([x + (direction[0] ?? 0) * step, y + (direction[1] ?? 0) * step]),
        series: key,
      }),
    );
  });
}

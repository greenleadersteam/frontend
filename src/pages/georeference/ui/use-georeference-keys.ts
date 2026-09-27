import { useWindowEvent } from '@mantine/hooks';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect } from 'react';

import { georeferenceActions as actions } from '@/entities/georeference';
import { isTyping } from '@/shared/lib/keyboard';
import { useAppDispatch } from '@/shared/lib/store';

const STEP_M = 1;
const STEP_SHIFT_M = 10;
const TURN_DEG = 0.5;
const TURN_SHIFT_DEG = 5;

// Коды клавиш не зависят от раскладки: KeyQ — это и Q, и Й, KeyZ — и Z, и Я.
const SHIFTS: Record<string, [east: number, north: number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};
const TURNS: Record<string, number> = { KeyQ: 1, KeyE: -1 };

type GeoreferenceKeysOptions = {
  map: MapLibreMap | null;
  // Нет открытого диалога: клавиши принадлежат странице.
  enabled: boolean;
  // Контур загружен: стрелки и Q, E двигают его. Отмена работает и без контура — первая отмена
  // после загрузки его убирает.
  contourLoaded: boolean;
};

// Клавиатура модуля: стрелки сдвигают контур на 1 м (с Shift — на 10 м), Q и E поворачивают на
// 0,5° (с Shift — на 5°), Ctrl+Z отменяет, Ctrl+Shift+Z и Ctrl+Y возвращают. В поле ввода
// клавиши принадлежат полю.
export function useGeoreferenceKeys({
  map,
  enabled,
  contourLoaded,
}: GeoreferenceKeysOptions): void {
  const moves = enabled && contourLoaded;
  const dispatch = useAppDispatch();

  // Стрелки двигают контур; KeyboardHandler MapLibre слушает контейнер карты раньше window
  // и сдвинул бы ещё и камеру.
  useEffect(() => {
    if (map === null) return;
    if (moves) map.keyboard.disable();
    else map.keyboard.enable();
  }, [map, moves]);

  useWindowEvent('keydown', (event) => {
    // Стрелки на ползунке, в списке и других виджетах Mantine уже обработаны ими самими:
    // они вызывают preventDefault, но всплытие не останавливают.
    if (!enabled || event.defaultPrevented || isTyping(event.target) || event.altKey) return;
    if (event.ctrlKey || event.metaKey) {
      if (event.code === 'KeyZ') {
        event.preventDefault();
        dispatch(event.shiftKey ? actions.redone() : actions.undone());
      } else if (event.code === 'KeyY') {
        event.preventDefault();
        dispatch(actions.redone());
      }
      return;
    }
    if (!moves) return;
    const shift = SHIFTS[event.key];
    if (shift !== undefined) {
      event.preventDefault();
      const step = event.shiftKey ? STEP_SHIFT_M : STEP_M;
      dispatch(actions.contourShifted({ east: shift[0] * step, north: shift[1] * step }));
      return;
    }
    const turn = TURNS[event.code];
    if (turn !== undefined) {
      event.preventDefault();
      const degrees = event.shiftKey ? TURN_SHIFT_DEG : TURN_DEG;
      dispatch(actions.contourTurned({ degrees: turn * degrees }));
    }
  });
}

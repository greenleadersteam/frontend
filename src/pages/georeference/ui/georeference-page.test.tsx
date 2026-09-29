import type { UnknownAction } from '@reduxjs/toolkit';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as MapLibre from 'maplibre-gl';
import { http, HttpResponse } from 'msw';
import { type ReactNode, useEffect } from 'react';
import { Link, Outlet } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { GEOREFERENCE_SLICE, georeferenceReducer, type Session } from '@/entities/georeference';
import type * as Config from '@/shared/config';
import { enuToGeodetic, geodeticToEnu } from '@/shared/lib/geodesy';
import { renderWithProviders, server } from '@/shared/lib/test';
import type * as SharedMap from '@/shared/map';

import { GeoreferencePage } from './georeference-page';

// Карта в jsdom не рисуется: MapView и маркер MapLibre подменяются объектами с теми методами,
// которыми пользуется страница. Центр карты — точка, куда встаёт новый контур.
const CENTER = { lng: 37.62, lat: 55.75 };

type Handler = (event: Record<string, unknown>) => void;

function createFakeMap() {
  const handlers = new Map<string, Set<Handler>>();
  const canvas = document.body.appendChild(document.createElement('canvas'));
  const container = { style: { touchAction: '' } };
  const setData = vi.fn();
  return {
    handlers,
    canvas,
    setData,
    emit: (type: string, event: Record<string, unknown>) => {
      for (const handler of handlers.get(type) ?? []) handler(event);
    },
    // Подписка на событие или на событие слоя: ключ «событие» или «событие:слой».
    on: vi.fn((type: string, layerOrHandler: string | Handler, handler?: Handler) => {
      const key = typeof layerOrHandler === 'string' ? `${type}:${layerOrHandler}` : type;
      const callback = typeof layerOrHandler === 'string' ? handler : layerOrHandler;
      if (callback !== undefined) handlers.set(key, (handlers.get(key) ?? new Set()).add(callback));
    }),
    off: vi.fn((type: string, layerOrHandler: string | Handler, handler?: Handler) => {
      const key = typeof layerOrHandler === 'string' ? `${type}:${layerOrHandler}` : type;
      const callback = typeof layerOrHandler === 'string' ? handler : layerOrHandler;
      if (callback !== undefined) handlers.get(key)?.delete(callback);
    }),
    fire: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getSource: () => ({ setData }),
    setPaintProperty: vi.fn(),
    setLayoutProperty: vi.fn(),
    setFilter: vi.fn(),
    // Попадание в контур задаёт тест.
    queryRenderedFeatures: vi.fn<(box: unknown, options?: { layers: string[] }) => unknown[]>(
      () => [{ properties: {} }],
    ),
    dragPan: { enable: vi.fn(), disable: vi.fn() },
    keyboard: { enable: vi.fn(), disable: vi.fn() },
    getCanvas: () => canvas,
    getCanvasContainer: () => container,
    getCenter: () => CENTER,
    project: vi.fn<(lngLat: unknown) => { x: number; y: number }>(() => ({ x: 100, y: 100 })),
    // MapMouseEvent передаёт точку объектом { x, y }.
    unproject: ({ x, y }: { x: number; y: number }) => ({
      lng: CENTER.lng + x * 1e-5,
      lat: CENTER.lat - y * 1e-5,
    }),
    fitBounds: vi.fn(),
  };
}
let fakeMap = createFakeMap();

// Маркер MapLibre: тест сам «тянет» его, как это делает MapLibre, — dragstart, drag, dragend.
const markers = vi.hoisted(() => ({ created: [] as FakeMarkerShape[] }));
type FakeMarkerShape = {
  element: HTMLElement;
  lngLat: { lng: number; lat: number };
  listeners: Map<string, Set<() => void>>;
  fire: (type: string) => void;
};

vi.mock('maplibre-gl', async (importOriginal) => {
  const actual = await importOriginal<typeof MapLibre>();
  class Marker implements FakeMarkerShape {
    element: HTMLElement;
    lngLat = { lng: 0, lat: 0 };
    listeners = new Map<string, Set<() => void>>();
    constructor({ element }: { element: HTMLElement }) {
      this.element = element;
      markers.created.push(this);
    }
    setLngLat([lng, lat]: [number, number]) {
      this.lngLat = { lng, lat };
      return this;
    }
    getLngLat() {
      return this.lngLat;
    }
    addTo() {
      if (!this.element.isConnected) document.body.append(this.element);
      return this;
    }
    remove() {
      this.element.remove();
      return this;
    }
    getElement() {
      return this.element;
    }
    on(type: string, listener: () => void) {
      this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener));
      return this;
    }
    fire(type: string) {
      for (const listener of this.listeners.get(type) ?? []) listener();
    }
  }
  return { ...actual, Marker };
});

const mapMock = vi.hoisted(() => ({ unavailable: false }));

vi.mock('@/shared/map', async (importOriginal) => ({
  ...(await importOriginal<typeof SharedMap>()),
  MapView: ({
    onReady,
    onUnavailable,
    children,
  }: {
    onReady: (map: unknown) => void;
    onUnavailable: () => void;
    children?: ReactNode;
  }) => {
    useEffect(() => {
      if (mapMock.unavailable) onUnavailable();
      else onReady(fakeMap);
      // Подмена создаёт «карту» один раз, как MapView.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- только при монтировании
    }, []);
    return (
      <div role="region" aria-label="Карта">
        {children}
      </div>
    );
  },
}));

const configMock = vi.hoisted(() => ({
  imagery: null as Config.ImageryConfig | null,
  manualGeoreference: false,
  obstacles: true,
}));
vi.mock('@/shared/config', async (importOriginal) => {
  const actual = await importOriginal<typeof Config>();
  return {
    ...actual,
    getRuntimeConfig: () => ({ ...actual.getRuntimeConfig(), imagery: configMock.imagery }),
    useCapability: (name: Config.Capability) =>
      name === 'manualGeoreference'
        ? configMock.manualGeoreference
        : name === 'obstacles'
          ? configMock.obstacles
          : actual.useCapability(name),
  };
});

// Действия сессии, дошедшие до store, и её последнее состояние.
let actions: UnknownAction[] = [];
let session: Session | null = null;
const reducers = {
  [GEOREFERENCE_SLICE]: (state: Session | undefined, action: UnknownAction) => {
    const next = georeferenceReducer(state, action);
    // Store прошлого теста получает поздние действия RTK Query: его сессия не должна подменять
    // сессию текущего теста. Последнее состояние — по действиям сессии и созданию store.
    if (action.type.startsWith(`${GEOREFERENCE_SLICE}/`)) {
      actions.push(action);
      session = next;
    } else if (state === undefined) {
      session = next;
    }
    return next;
  },
};
const georeferenceActions = () =>
  actions.map(({ type }) => type.replace(`${GEOREFERENCE_SLICE}/`, ''));

const renderPage = () =>
  renderWithProviders(
    [{ path: '/georeference', Component: GeoreferencePage }],
    '/georeference',
    reducers,
  );

// Поле выбора файла — в зоне загрузки панели «Контур»; у зоны на весь окно своё поле.
const panelInput = () =>
  screen.getByRole('button', { name: 'Открыть GeoJSON с границей участка' }).querySelector('input');

const SQUARE = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ],
  ],
});

async function loadSquare() {
  const input = panelInput();
  if (input === null) throw new Error('нет поля выбора файла');
  await userEvent.upload(
    input,
    new File([SQUARE], 'квадрат.geojson', { type: 'application/geo+json' }),
  );
  await screen.findByText('квадрат.geojson');
  actions = [];
}

const anchorOf = () => {
  if (session?.anchor == null) throw new Error('контур не загружен');
  return session.anchor;
};
const lngLatAt = (e: number, n: number) => {
  const { lat, lon } = enuToGeodetic({ e, n }, anchorOf());
  return { lng: lon, lat };
};

beforeEach(() => {
  fakeMap = createFakeMap();
  markers.created = [];
  configMock.imagery = null;
  configMock.manualGeoreference = false;
  configMock.obstacles = true;
  mapMock.unavailable = false;
  actions = [];
  session = null;
});

afterEach(() => {
  fakeMap.canvas.remove();
  for (const marker of markers.created) marker.element.remove();
  vi.restoreAllMocks();
  server.events.removeAllListeners();
});

describe('пустое состояние', () => {
  test('подсказка и «Открыть пример»; панель «Привязка» объясняет, что делать', async () => {
    renderPage();

    expect(
      await screen.findByText(
        'Загрузите границу участка в координатах чертежа — GeoJSON с полигоном',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Открыть пример' }).length).toBeGreaterThan(0);
    expect(screen.getByText(/перетащите его мышью на место/)).toBeInTheDocument();
  });
});

describe('загрузка', () => {
  test('контур встаёт в центр карты, вид вписывается, пустое состояние уходит', async () => {
    renderPage();
    await loadSquare();

    expect(anchorOf()).toEqual({ lat: CENTER.lat, lon: CENTER.lng });
    expect(fakeMap.fitBounds).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText('Загрузите границу участка в координатах чертежа — GeoJSON с полигоном'),
    ).not.toBeInTheDocument();
  });

  test('файл не JSON — уведомление с объяснением, контура нет', async () => {
    renderPage();
    const input = panelInput();
    if (input === null) throw new Error('нет поля выбора файла');
    await userEvent.upload(
      input,
      new File(['не json'], 'план.geojson', { type: 'application/json' }),
    );

    expect(
      await screen.findByText(/^Файл «план\.geojson» не открыт\. Файл не разбирается как JSON/),
    ).toBeInTheDocument();
    expect(session?.source ?? null).toBeNull();
  });

  test('собственная выгрузка — вопрос «Открыть как эталон?», а не контур', async () => {
    renderPage();
    const exported = JSON.stringify({
      type: 'Feature',
      properties: {
        поворот_градусы: 0,
        масштаб_метров_в_единице_файла: 1,
        опорная_точка: [37.62, 55.75],
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [37.62, 55.75],
            [37.621, 55.75],
            [37.621, 55.751],
            [37.62, 55.75],
          ],
        ],
      },
    });
    const input = panelInput();
    if (input === null) throw new Error('нет поля выбора файла');
    await userEvent.upload(
      input,
      new File([exported], 'привязка.geojson', { type: 'application/geo+json' }),
    );

    const dialog = await screen.findByRole('dialog', { name: 'Открыть как эталон?' });
    expect(dialog).toHaveTextContent('«привязка.geojson» — результат привязки из этого модуля');
    await userEvent.click(screen.getByRole('button', { name: 'Открыть как эталон' }));

    expect(session?.references).toHaveLength(1);
    expect(session?.source ?? null).toBeNull();
    // Пока диалог закрывается, остальная страница скрыта от скринридера.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('switch', { name: 'привязка.geojson Вершин: 3' })).toBeChecked();
  });
});

describe('перетаскивание', () => {
  test('за всё перетаскивание — ровно одно действие, карта в это время не двигается', async () => {
    renderPage();
    await loadSquare();
    const start = anchorOf();
    const at = { lng: CENTER.lng, lat: CENTER.lat };

    act(() => {
      fakeMap.emit('mousedown', {
        point: { x: 10, y: 10 },
        lngLat: at,
        originalEvent: { button: 0 },
        preventDefault: vi.fn(),
      });
    });
    expect(fakeMap.dragPan.disable).toHaveBeenCalledTimes(1);
    for (let step = 1; step <= 30; step += 1) {
      act(() => {
        fakeMap.emit('mousemove', { lngLat: { lng: at.lng + step * 1e-5, lat: at.lat } });
      });
    }
    expect(actions).toEqual([]);
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'));
    });

    expect(georeferenceActions()).toEqual(['contourMoved']);
    expect(fakeMap.dragPan.enable).toHaveBeenCalledTimes(1);
    // Смещение от курсора постоянное: опорная точка ушла ровно туда же, куда курсор.
    const moved = geodeticToEnu({ ...anchorOf(), h: 0 }, { ...start, h: 0 });
    const cursor = geodeticToEnu(
      { lat: at.lat, lon: at.lng + 30e-5, h: 0 },
      { lat: at.lat, lon: at.lng, h: 0 },
    );
    expect(moved.e).toBeCloseTo(cursor.e, 6);
    expect(moved.n).toBeCloseTo(cursor.n, 6);
  });

  test('мимо контура — не жест: карта двигается как обычно, действий нет', async () => {
    renderPage();
    await loadSquare();
    fakeMap.queryRenderedFeatures.mockReturnValue([]);

    act(() => {
      fakeMap.emit('mousedown', {
        point: { x: 10, y: 10 },
        lngLat: CENTER,
        originalEvent: { button: 0 },
        preventDefault: vi.fn(),
      });
      window.dispatchEvent(new MouseEvent('mouseup'));
    });

    expect(fakeMap.dragPan.disable).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });
});

describe('поворот ручкой', () => {
  const turnHandle = (to: { lng: number; lat: number }, shift = false) => {
    const [handle] = markers.created;
    if (handle === undefined) throw new Error('нет ручки');
    act(() => {
      handle.fire('dragstart');
      if (shift)
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
      handle.lngLat = to;
      handle.fire('drag');
      handle.fire('dragend');
      if (shift)
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', shiftKey: false }));
    });
  };

  test('ручка к востоку — поворот −90°: rotation = −atan2(e, n)', async () => {
    renderPage();
    await loadSquare();

    turnHandle(lngLatAt(100, 0));

    expect(georeferenceActions()).toEqual(['contourRotated']);
    expect(session?.rotation).toBeCloseTo(-90, 6);
  });

  test('с Shift — шаг 15°, без Shift — свободно', async () => {
    renderPage();
    await loadSquare();
    const angle = (37 * Math.PI) / 180;
    const northWest = lngLatAt(-100 * Math.sin(angle), 100 * Math.cos(angle));

    turnHandle(northWest, true);
    expect(session?.rotation).toBe(30);
    turnHandle(northWest);
    expect(session?.rotation).toBeCloseTo(37, 6);
  });

  test('после десяти поворотов ручка одна', async () => {
    renderPage();
    await loadSquare();

    for (let turn = 1; turn <= 10; turn += 1) {
      const angle = (turn * 17 * Math.PI) / 180;
      turnHandle(lngLatAt(-100 * Math.sin(angle), 100 * Math.cos(angle)));
    }

    expect(georeferenceActions()).toHaveLength(10);
    expect(markers.created).toHaveLength(1);
    expect(document.querySelectorAll('[aria-hidden="true"][class*="handle"]')).toHaveLength(1);
  });

  test('нажатие на ручку — не перетаскивание контура, даже если контур рядом', async () => {
    renderPage();
    await loadSquare();
    const [handle] = markers.created;
    if (handle === undefined) throw new Error('нет ручки');

    act(() => {
      fakeMap.emit('mousedown', {
        point: { x: 10, y: 10 },
        lngLat: CENTER,
        originalEvent: { button: 0, target: handle.element },
        preventDefault: vi.fn(),
      });
    });

    expect(fakeMap.dragPan.disable).not.toHaveBeenCalled();
  });

  test('отпущена за краем карты — жест всё равно заканчивается', async () => {
    renderPage();
    await loadSquare();
    const [handle] = markers.created;
    if (handle === undefined) throw new Error('нет ручки');

    act(() => {
      handle.fire('dragstart');
      window.dispatchEvent(new MouseEvent('mouseup'));
    });

    expect(fakeMap.fire).toHaveBeenCalledTimes(1);
    expect(fakeMap.fire.mock.calls[0]?.[0]).toMatchObject({ type: 'mouseup' });
  });
});

describe('опорные точки', () => {
  const click = (x: number, y: number, lngLat = CENTER) => {
    act(() => {
      fakeMap.emit('click', { point: { x, y }, lngLat, originalEvent: { button: 0 } });
    });
  };

  test('первая точка притягивается к вершине в 12 px, вторая — место на карте; одно действие', async () => {
    renderPage();
    await loadSquare();
    await userEvent.click(screen.getByRole('button', { name: 'Расставить опорные точки' }));
    // Вершина (100, 0) квадрата отрисована в 5 px от щелчка.
    fakeMap.queryRenderedFeatures.mockImplementation((_box, options) =>
      options?.layers.includes('georeference-vertices') === true
        ? [{ properties: { x: 100, y: 0 } }]
        : [],
    );
    fakeMap.project.mockReturnValue({ x: 205, y: 300 });

    click(200, 300);
    expect(actions).toEqual([]);
    expect(screen.getByText(/Теперь укажите на карте/)).toBeInTheDocument();
    click(400, 300, { lng: 37.63, lat: 55.76 });

    expect(georeferenceActions()).toEqual(['gcpAdded']);
    expect(actions[0]?.payload).toEqual({
      pair: { x: 100, y: 0, kind: 'vertex', lat: 55.76, lon: 37.63 },
    });
  });

  test('в режиме контур не тянется; Esc отменяет первую точку, затем выходит из режима', async () => {
    renderPage();
    await loadSquare();
    await userEvent.click(screen.getByRole('button', { name: 'Расставить опорные точки' }));

    act(() => {
      fakeMap.emit('mousedown', {
        point: { x: 10, y: 10 },
        lngLat: CENTER,
        originalEvent: { button: 0 },
        preventDefault: vi.fn(),
      });
    });
    expect(fakeMap.dragPan.disable).not.toHaveBeenCalled();

    click(100, 100);
    expect(screen.getByText(/Теперь укажите на карте/)).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.getByText(/Щёлкните по контуру/)).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Расставить опорные точки' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('две пары — блокировка ручного совмещения, «Вернуть ручное», таблица невязок', async () => {
    renderPage();
    await loadSquare();
    await userEvent.click(screen.getByRole('button', { name: 'Расставить опорные точки' }));
    fakeMap.queryRenderedFeatures.mockReturnValue([]);
    const project = (x: number) => ({ x, y: 300 });
    // Вершины квадрата 0 и 1 на экране — в 400 и 500 px; щелчки точно по ним.
    fakeMap.project.mockImplementation((lngLat) =>
      Array.isArray(lngLat) && typeof lngLat[0] === 'number' && lngLat[0] > CENTER.lng
        ? project(500)
        : project(400),
    );
    click(400, 300);
    click(0, 0, { lng: 37.6, lat: 55.7 });
    click(500, 300);
    click(0, 0, { lng: 37.601, lat: 55.7 });

    expect(georeferenceActions()).toEqual(['gcpAdded', 'gcpAdded']);
    expect(screen.getByText(/Положение задано опорными точками/)).toBeInTheDocument();
    expect(screen.getByLabelText('Поворот против часовой')).toBeDisabled();
    expect(screen.getAllByRole('row')).toHaveLength(3);

    await userEvent.click(screen.getByRole('button', { name: 'Вернуть ручное' }));
    expect(anchorOf()).toEqual({ lat: CENTER.lat, lon: CENTER.lng });
    expect(
      screen
        .getAllByRole('checkbox', { name: /^Учитывать точку/ })
        .map((box) => (box as HTMLInputElement).checked),
    ).toEqual([false, false]);
  });
});

describe('клавиатура', () => {
  const press = (init: KeyboardEventInit) => {
    fireEvent.keyDown(document.body, init);
  };

  test('стрелки — 1 м, с Shift — 10 м; Q и E — 0,5°, с Shift — 5°', async () => {
    renderPage();
    await loadSquare();

    press({ key: 'ArrowUp', code: 'ArrowUp' });
    press({ key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: true });
    press({ key: 'q', code: 'KeyQ' });
    press({ key: 'E', code: 'KeyE', shiftKey: true });

    expect(actions.map(({ payload }) => payload)).toEqual([
      { east: 0, north: 1 },
      { east: -10, north: 0 },
      { degrees: 0.5 },
      { degrees: -5 },
    ]);
  });

  test('русская раскладка: Й и У поворачивают, Ctrl+Я отменяет', async () => {
    renderPage();
    await loadSquare();

    press({ key: 'й', code: 'KeyQ' });
    press({ key: 'У', code: 'KeyE', shiftKey: true });
    press({ key: 'я', code: 'KeyZ', ctrlKey: true });
    press({ key: 'Я', code: 'KeyZ', ctrlKey: true, shiftKey: true });
    press({ key: 'н', code: 'KeyY', ctrlKey: true });

    expect(georeferenceActions()).toEqual([
      'contourTurned',
      'contourTurned',
      'undone',
      'redone',
      'redone',
    ]);
  });

  test('в поле ввода клавиши принадлежат полю', async () => {
    renderPage();
    await loadSquare();
    const field = screen.getByLabelText('Поворот против часовой');
    field.focus();

    for (const init of [
      { key: 'ArrowUp', code: 'ArrowUp' },
      { key: 'q', code: 'KeyQ' },
      { key: 'й', code: 'KeyQ' },
      { key: 'z', code: 'KeyZ', ctrlKey: true },
    ]) {
      fireEvent.keyDown(field, init);
    }
    fireEvent.keyDown(screen.getByLabelText('Метров в единице файла'), {
      key: 'ArrowDown',
      code: 'ArrowDown',
    });

    expect(actions).toEqual([]);
  });

  test('стрелки на ползунке «Заливка» меняют заливку, а не двигают контур', async () => {
    renderPage();
    await loadSquare();
    const slider = screen.getByRole('slider');
    slider.focus();

    fireEvent.keyDown(slider, { key: 'ArrowRight', code: 'ArrowRight' });

    expect(slider).toHaveAttribute('aria-valuenow', '0.2');
    expect(actions).toEqual([]);
  });

  test('без контура стрелки отданы карте, отмена работает', async () => {
    renderPage();
    await screen.findByText(/перетащите его мышью на место/);

    press({ key: 'ArrowUp', code: 'ArrowUp' });
    press({ key: 'z', code: 'KeyZ', ctrlKey: true });

    expect(georeferenceActions()).toEqual(['undone']);
    expect(fakeMap.keyboard.disable).not.toHaveBeenCalled();
  });
});

describe('история', () => {
  test('Ctrl+Z отменяет поворот, затем сдвиг', async () => {
    renderPage();
    await loadSquare();
    const start = anchorOf();
    fireEvent.keyDown(document.body, { key: 'ArrowRight', code: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(document.body, { key: 'q', code: 'KeyQ' });

    fireEvent.keyDown(document.body, { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(session?.rotation).toBe(0);
    expect(anchorOf()).not.toEqual(start);
    fireEvent.keyDown(document.body, { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(anchorOf()).toEqual(start);
  });

  test('поле масштаба: значение по Enter — шаг истории, «Единицы файла» следуют за ним', async () => {
    renderPage();
    await loadSquare();
    const field = screen.getByLabelText('Метров в единице файла');

    await userEvent.clear(field);
    await userEvent.type(field, '0,001{Enter}');

    expect(georeferenceActions()).toEqual(['contourScaled']);
    expect(session?.scale).toBe(0.001);
    expect(screen.getByLabelText('Единицы файла', { selector: 'input' })).toHaveValue('миллиметры');
  });
});

describe('карта недоступна', () => {
  test('без WebGL — объяснение вместо подсказки, открыть файл нельзя ни кнопкой, ни зоной', async () => {
    mapMock.unavailable = true;
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Карта не открылась или перестала отвечать',
    );
    expect(screen.getByRole('button', { name: 'Открыть пример' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Открыть GeoJSON с границей участка' }),
    ).toHaveAttribute('data-disabled', 'true');
    expect(
      screen.queryByText('Загрузите границу участка в координатах чертежа — GeoJSON с полигоном'),
    ).not.toBeInTheDocument();
  });
});

describe('подложки', () => {
  test('без снимка в конфиге переключателя нет', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Карта' });

    expect(screen.queryByRole('radio', { name: 'Снимок' })).not.toBeInTheDocument();
  });

  test('со снимком — «Схема» и «Снимок», по умолчанию «Схема»', async () => {
    configMock.imagery = {
      tilesUrl: 'https://tiles.example.org/{z}/{y}/{x}',
      labelsUrl: 'https://tiles.example.org/labels/{z}/{y}/{x}',
      attribution: 'Источник',
    };
    renderPage();

    expect(await screen.findByRole('radio', { name: 'Схема' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Снимок' })).not.toBeChecked();
  });

  test('снимок не прислал ни одного тайла за три секунды — уведомление с источником', async () => {
    configMock.imagery = {
      tilesUrl: 'https://tiles.example.org/{z}/{y}/{x}',
      labelsUrl: 'https://tiles.example.org/labels/{z}/{y}/{x}',
      attribution: 'Источник',
    };
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPage();
      const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
      await user.click(await screen.findByRole('radio', { name: 'Снимок' }));
      act(() => {
        fakeMap.emit('dataloading', { sourceId: 'imagery', tile: {}, dataType: 'source' });
        vi.advanceTimersByTime(3000);
      });

      expect(
        await screen.findByText(
          /^Подложка «Снимок» не загрузилась: космоснимок tiles\.example\.org не отвечает/,
        ),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('режим проекта', () => {
  // «Улица Шаболовка, 37» из моков: готова, без геопривязки; граница участка — 60 × 23 м,
  // центр габарита — (30; 8,5) м чертежа.
  const PROJECT_ID = '0e8d2b6a4c1f47e9a3b5d7c9e1f2a4b6';
  const renderProjectMode = (id = PROJECT_ID) =>
    renderWithProviders(
      [
        { path: '/georeference', Component: GeoreferencePage },
        {
          path: '/projects/:projectId',
          element: (
            <>
              <h1>Страница проекта</h1>
              <Link to="/georeference">Модуль геопривязки</Link>
            </>
          ),
        },
      ],
      `/georeference?project=${id}`,
      reducers,
    );
  const opened = async () => {
    await screen.findByText('Граница участка из чертежа');
    await waitFor(() => {
      expect(session?.projectId).toBe(PROJECT_ID);
    });
  };
  // Привязку проекта применяет только сервер: без manualGeoreference режима проекта нет.
  beforeEach(() => {
    configMock.manualGeoreference = true;
  });

  test('без manualGeoreference — объяснение и «Назад к проекту», модуля нет', async () => {
    configMock.manualGeoreference = false;
    renderProjectMode();

    expect(
      await screen.findByText(/^Привязать проект к карте можно будет в следующей версии/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Применить к проекту' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Назад к проекту' }));
    expect(await screen.findByRole('heading', { name: 'Страница проекта' })).toBeInTheDocument();
  });

  test('контур — граница участка проекта в центре карты; файлов контура и единиц нет', async () => {
    renderProjectMode();
    await opened();

    expect(screen.getByText('Улица Шаболовка, 37')).toBeInTheDocument();
    expect(georeferenceActions()).toEqual(['projectOpened']);
    expect(anchorOf()).toEqual({ lat: CENTER.lat, lon: CENTER.lng });
    expect(session?.source?.center).toEqual({ x: 30, y: 8.5 });
    expect([session?.rotation, session?.scale, session?.undoStack]).toEqual([0, 1, []]);
    expect(fakeMap.fitBounds).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Открыть пример' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Единицы файла' })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /^План проекта/ })).toBeChecked();
    // Первая отмена контур проекта не убирает: истории у только что открытого нет.
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(session?.source).not.toBeNull();
  });

  test('файл контура в режиме проекта не открывается — только эталоны', async () => {
    renderProjectMode();
    await opened();
    const input = screen
      .getByRole('button', { name: 'Открыть эталон — выгрузку привязки' })
      .querySelector('input');
    if (input === null) throw new Error('нет поля выбора файла');

    await userEvent.upload(
      input,
      new File([SQUARE], 'квадрат.geojson', { type: 'application/geo+json' }),
    );

    expect(
      await screen.findByText(/^Файл «квадрат\.geojson» не открыт: контур здесь/),
    ).toBeInTheDocument();
    expect(session?.source?.name).toBe('Улица Шаболовка, 37');
  });

  test('«Применить к проекту» — PUT /georeference со сдвигом контура и назад к проекту', async () => {
    const bodies: unknown[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'PUT')
        void request
          .clone()
          .json()
          .then((body: unknown) => bodies.push(body));
    });
    renderProjectMode();
    await opened();
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');

    await userEvent.click(screen.getByRole('button', { name: 'Применить к проекту' }));

    expect(await screen.findByRole('heading', { name: 'Страница проекта' })).toBeInTheDocument();
    expect(
      await screen.findByText('Привязка отправлена: проект обрабатывается заново'),
    ).toBeInTheDocument();
    expect(bodies).toEqual([
      {
        anchor_wgs84: anchorOf(),
        anchor_drawing: { x: 30, y: 8.5 },
        rotation_deg: 0,
        scale: 1,
        method: 'manual',
        rms_m: null,
        control_points: [],
      },
    ]);
    const { e } = geodeticToEnu(anchorOf(), { lat: CENTER.lat, lon: CENTER.lng });
    expect(e).toBeCloseTo(10, 6);
  });

  test('сервер отказал в PUT — уведомление, пользователь остаётся в модуле', async () => {
    server.use(
      http.put('/api/projects/:projectId/georeference', () =>
        HttpResponse.json({ detail: 'Project is not runnable' }, { status: 409 }),
      ),
    );
    renderProjectMode();
    await opened();

    await userEvent.click(screen.getByRole('button', { name: 'Применить к проекту' }));

    expect(
      await screen.findByText(
        'Действие недоступно в текущем состоянии проекта. Обновите страницу и проверьте статус.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Применить к проекту' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Страница проекта' })).not.toBeInTheDocument();
  });

  test('без карты контур проекта не открывается, и контур из файла к проекту не применить', async () => {
    renderWithProviders(
      [
        {
          element: (
            <>
              <Link to={`/georeference?project=${PROJECT_ID}`}>Привязать проект</Link>
              <Outlet />
            </>
          ),
          children: [{ path: '/georeference', Component: GeoreferencePage }],
        },
      ],
      '/georeference',
      reducers,
    );
    await loadSquare();
    mapMock.unavailable = true;

    await userEvent.click(screen.getByRole('link', { name: 'Привязать проект' }));

    expect(await screen.findByText('Граница участка из чертежа')).toBeInTheDocument();
    expect(
      await screen.findByText('Карта не открылась или перестала отвечать'),
    ).toBeInTheDocument();
    // В сессии всё ещё квадрат из файла, но экран проекта его не видит.
    expect(session?.source?.name).toBe('квадрат.geojson');
    expect(screen.getByRole('button', { name: 'Применить к проекту' })).toBeDisabled();
    expect(screen.queryByText('квадрат.geojson')).not.toBeInTheDocument();
  });

  test('«Отмена» — назад к проекту без изменений', async () => {
    renderProjectMode();
    await opened();

    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(await screen.findByRole('heading', { name: 'Страница проекта' })).toBeInTheDocument();
  });

  test('некорректный идентификатор проекта — «Страница не найдена»', async () => {
    renderProjectMode('не-проект');

    expect(await screen.findByRole('heading', { name: 'Страница не найдена' })).toBeInTheDocument();
  });

  test('после режима проекта модуль без проекта начинает с пустого контура', async () => {
    renderProjectMode();
    await opened();
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await userEvent.click(await screen.findByRole('link', { name: 'Модуль геопривязки' }));

    await waitFor(() => {
      expect(session?.source).toBeNull();
    });
    expect(georeferenceActions().at(-1)).toBe('projectClosed');
  });
});

describe('проект, упавший на геопривязке', () => {
  // «Улица Бахрушина, 11»: insufficient_geodetic_points; граница участка — 60 × 23 м.
  const FAILED_ID = 'e5b7d9f1a3c54f6e8a0c2e4b6d8f1a3c';
  const renderFailed = () =>
    renderWithProviders(
      [
        { path: '/georeference', Component: GeoreferencePage },
        { path: '/projects/:projectId', element: <h1>Страница проекта</h1> },
      ],
      `/georeference?project=${FAILED_ID}`,
      reducers,
    );

  test('контур — граница участка из подосновы; «Применить» — PUT, проект обрабатывается заново', async () => {
    configMock.manualGeoreference = true;
    const puts: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'PUT') puts.push(new URL(request.url).pathname);
    });
    renderFailed();

    expect(await screen.findByText('Граница участка из подосновы')).toBeInTheDocument();
    await waitFor(() => {
      expect(session?.projectId).toBe(FAILED_ID);
    });
    expect(session?.source?.center).toEqual({ x: 30, y: 8.5 });
    expect(screen.queryByRole('switch', { name: /^План проекта/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Применить к проекту' }));

    expect(await screen.findByRole('heading', { name: 'Страница проекта' })).toBeInTheDocument();
    expect(puts).toEqual([`/api/projects/${FAILED_ID}/georeference`]);
  });

  test('без объектов подосновы — контур загружается файлом и становится контуром проекта', async () => {
    configMock.manualGeoreference = true;
    configMock.obstacles = false;
    renderFailed();

    // Причина — у сервера нет объектов подосновы, а не «границы в чертеже нет»: в панели
    // и на карте.
    expect(await screen.findAllByText(/^Сервер не отдаёт объекты подосновы/)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Применить к проекту' })).toBeDisabled();
    await loadSquare();

    expect(session?.projectId).toBe(FAILED_ID);
    expect(screen.getByRole('button', { name: 'Применить к проекту' })).toBeEnabled();
    expect(screen.getByText('Граница участка из файла')).toBeInTheDocument();
  });

  // На реальном сервере parsed.geojson пишется после геопривязки: у упавшего проекта /obstacles
  // ответит 404. Это не сбой, а «подосновы нет» — сразу загрузка файлом, без «Повторить».
  test('404 от /obstacles — «Сервер не отдаёт объекты подосновы», без «Повторить»', async () => {
    configMock.manualGeoreference = true;
    server.use(
      http.get('/api/projects/:projectId/obstacles', () => new HttpResponse(null, { status: 404 })),
    );
    renderFailed();

    expect(await screen.findAllByText(/^Сервер не отдаёт объекты подосновы/)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument();
  });

  test('файл контура похож на миллиметры — предупреждение, масштаба 0,001 не предлагается', async () => {
    configMock.manualGeoreference = true;
    configMock.obstacles = false;
    renderFailed();
    await screen.findAllByText(/^Сервер не отдаёт объекты подосновы/);
    const input = screen
      .getByRole('button', { name: 'Открыть GeoJSON с границей участка' })
      .querySelector('input');
    if (input === null) throw new Error('нет поля выбора файла');
    const millimetres = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [60_000, 0],
          [60_000, 23_000],
          [0, 23_000],
          [0, 0],
        ],
      ],
    });

    await userEvent.upload(
      input,
      new File([millimetres], 'граница-мм.geojson', { type: 'application/geo+json' }),
    );

    expect(await screen.findByText(/похоже, файл в миллиметрах/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Применить миллиметры' })).not.toBeInTheDocument();
  });

  test('сбой /obstacles — ошибка с «Повторить»; можно загрузить границу файлом', async () => {
    configMock.manualGeoreference = true;
    server.use(
      http.get('/api/projects/:projectId/obstacles', () => new HttpResponse(null, { status: 500 })),
    );
    renderFailed();

    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Загрузить границу файлом' }));

    expect(await screen.findAllByText(/^Объекты подосновы не загрузились/)).toHaveLength(2);
  });

  test('без manualGeoreference — объяснение, модуля нет', async () => {
    renderFailed();

    expect(
      await screen.findByText(/^Привязать проект к карте можно будет в следующей версии/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Применить к проекту' })).not.toBeInTheDocument();
  });
});

import type { Map as MapLibreMap } from 'maplibre-gl';
import { afterEach, describe, expect, test, vi } from 'vitest';

import devConfig from '../../../config.dev.json';
import buildConfig from '../../../public/config.json';
import { basemapStyle } from './basemap-style';
import {
  BASEMAP_SOURCE,
  BASEMAP_STATUS_DELAY_MS,
  basemapLayerShown,
  basemapOptions,
  basemapStatus,
  IMAGERY_LABELS_SOURCE,
  IMAGERY_MAX_ZOOM,
  IMAGERY_NATIVE_ZOOM,
  IMAGERY_SOURCE,
  watchBasemap,
} from './basemaps';

// Замена 15 проверок конфигурации подложек прототипа (../geojson/tests.html:302-381): у нас
// другие подложки — своя офлайн-схема и снимок из конфига контура, Яндекса нет.

const IMAGERY = {
  tilesUrl: 'https://tiles.example.org/imagery/{z}/{y}/{x}',
  labelsUrl: 'https://tiles.example.org/labels/{z}/{y}/{x}',
  attribution: 'Powered by Esri; Source: Esri',
};

describe('состав подложек', () => {
  test('со снимком подложек четыре, в заданном порядке', () => {
    expect(basemapOptions(IMAGERY).map(({ title }) => title)).toEqual([
      'Схема',
      'Светлая',
      'Снимок',
      'Снимок с подписями',
    ]);
  });

  test('по умолчанию — «Схема»: своя подложка, работает без интернета', () => {
    expect(basemapOptions(IMAGERY)[0]?.kind).toBe('scheme');
  });

  test('imagery: null убирает оба снимка: остаются свои «Схема» и «Светлая»', () => {
    expect(basemapOptions(null).map(({ kind }) => kind)).toEqual(['scheme', 'light']);
  });

  test('по источникам подложки видно, загрузилась ли она: подписи — только у второго снимка', () => {
    expect(basemapOptions(IMAGERY).map(({ sourceIds }) => sourceIds)).toEqual([
      [BASEMAP_SOURCE],
      [BASEMAP_SOURCE],
      [IMAGERY_SOURCE],
      [IMAGERY_SOURCE, IMAGERY_LABELS_SOURCE],
    ]);
  });

  test('у каждой подложки названы источник и атрибуция', () => {
    for (const option of basemapOptions(IMAGERY)) {
      expect(option.source, option.title).not.toBe('');
      expect(option.attribution, option.title).not.toBe('');
    }
    expect(basemapOptions(IMAGERY).map(({ attribution }) => attribution)).toEqual([
      '© участники OpenStreetMap, Protomaps',
      '© участники OpenStreetMap, Protomaps',
      IMAGERY.attribution,
      IMAGERY.attribution,
    ]);
  });

  test('снимок тянется до 21-го масштаба, тайлы — до 19-го', () => {
    const style = basemapStyle('http://localhost/basemap/moscow.pmtiles', IMAGERY);
    expect(IMAGERY_MAX_ZOOM).toBe(21);
    expect(style.sources[IMAGERY_SOURCE]).toMatchObject({
      type: 'raster',
      maxzoom: IMAGERY_NATIVE_ZOOM,
    });
    expect(style.sources[IMAGERY_LABELS_SOURCE]).toMatchObject({ maxzoom: IMAGERY_NATIVE_ZOOM });
  });

  test('ни Яндекса, ни tile.openstreetmap.org: ни в стиле, ни в конфиге разработки', () => {
    const text = JSON.stringify([
      basemapStyle('/basemap/moscow.pmtiles', IMAGERY),
      devConfig,
      buildConfig,
    ]);
    expect(text).not.toMatch(/yandex|tile\.openstreetmap\.org/i);
  });

  test('конфиг сборки безопасен для контура заказчика: снимка нет', () => {
    expect(buildConfig.imagery).toBeNull();
  });

  test('конфиг разработки: снимок Esri с полной атрибуцией', () => {
    expect(devConfig.imagery.attribution).toMatch(/^Powered by Esri; Source: Esri/);
    expect(devConfig.imagery.tilesUrl).toMatch(/^https:\/\/server\.arcgisonline\.com\//);
  });
});

describe('стиль со снимком', () => {
  const style = basemapStyle('http://localhost/basemap/moscow.pmtiles', IMAGERY);
  const ids = style.layers.map(({ id }) => id);

  test('снимок и подписи скрыты, пока их не выбрали; подписи — над снимком', () => {
    for (const id of [IMAGERY_SOURCE, IMAGERY_LABELS_SOURCE]) {
      expect(style.layers.find((layer) => layer.id === id)?.layout).toEqual({ visibility: 'none' });
    }
    expect(ids.indexOf(IMAGERY_LABELS_SOURCE)).toBe(ids.indexOf(IMAGERY_SOURCE) + 1);
  });

  test('снимок — над фонами схем, под их остальными слоями', () => {
    expect(ids.slice(0, 2)).toEqual(['background', 'light:background']);
    expect(ids.indexOf(IMAGERY_SOURCE)).toBe(2);
    expect(ids.length).toBeGreaterThan(5);
  });

  test('атрибуция из конфига — текстом: MapLibre вставляет её как HTML', () => {
    const hostile = basemapStyle(null, { ...IMAGERY, attribution: '<img src=x onerror=alert(1)>' });
    expect(hostile.sources[IMAGERY_SOURCE]).toMatchObject({
      attribution: '&lt;img src=x onerror=alert(1)&gt;',
    });
  });

  test('без архива схемы снимок остаётся', () => {
    const noScheme = basemapStyle(null, IMAGERY);
    expect(noScheme.layers.map(({ id }) => id)).toEqual([
      'background',
      IMAGERY_SOURCE,
      IMAGERY_LABELS_SOURCE,
    ]);
  });
});

describe('видимость слоёв при выборе подложки', () => {
  const layers = {
    scheme: { id: 'roads_major', source: BASEMAP_SOURCE },
    light: { id: 'light:roads_major', source: BASEMAP_SOURCE },
    lightBackground: { id: 'light:background' },
    imagery: { id: IMAGERY_SOURCE, source: IMAGERY_SOURCE },
    labels: { id: IMAGERY_LABELS_SOURCE, source: IMAGERY_LABELS_SOURCE },
  };
  const shown = (kind: Parameters<typeof basemapLayerShown>[1]) =>
    Object.fromEntries(
      Object.entries(layers).map(([name, layer]) => [name, basemapLayerShown(layer, kind)]),
    );

  test.each([
    [
      'scheme',
      { scheme: true, light: false, lightBackground: false, imagery: false, labels: false },
    ],
    ['light', { scheme: false, light: true, lightBackground: true, imagery: false, labels: false }],
    [
      'imagery',
      { scheme: false, light: false, lightBackground: false, imagery: true, labels: false },
    ],
    [
      'imagery-labels',
      { scheme: false, light: false, lightBackground: false, imagery: true, labels: true },
    ],
    [null, { scheme: false, light: false, lightBackground: false, imagery: false, labels: false }],
  ] as const)('%s', (kind, expected) => {
    expect(shown(kind)).toEqual(expected);
  });

  test('слои проекта и фон «Земля» подложке не принадлежат: переключение их не трогает', () => {
    expect(
      basemapLayerShown({ id: 'planting-trees', source: 'planting' }, 'light'),
    ).toBeUndefined();
    expect(basemapLayerShown({ id: 'background' }, null)).toBeUndefined();
  });
});

describe('статус подложки', () => {
  test('хоть один успешный тайл — работает', () => {
    expect(basemapStatus({ requested: 9, loaded: 1, failed: 0 }, 400)).toBe('ok');
  });

  test('три секунды без единого успешного — недоступна', () => {
    expect(basemapStatus({ requested: 9, loaded: 0, failed: 9 }, BASEMAP_STATUS_DELAY_MS)).toBe(
      'unavailable',
    );
  });

  test('ошибки за краем покрытия при успешных — работает', () => {
    expect(basemapStatus({ requested: 26, loaded: 20, failed: 6 }, 5000)).toBe('ok');
  });

  test('скрытая ничего не запрашивает — без тревоги', () => {
    expect(basemapStatus({ requested: 0, loaded: 0, failed: 0 }, 9000)).toBe('pending');
  });

  test('до трёх секунд без тайлов — ещё ждём, даже при ошибках', () => {
    expect(basemapStatus({ requested: 9, loaded: 0, failed: 9 }, 2999)).toBe('pending');
  });
});

describe('watchBasemap', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  type Handler = (event: Record<string, unknown>) => void;
  function fakeMap() {
    const handlers = new Map<string, Set<Handler>>();
    const map = {
      on: (type: string, handler: Handler) => {
        const set = handlers.get(type) ?? new Set();
        set.add(handler);
        handlers.set(type, set);
      },
      off: (type: string, handler: Handler) => handlers.get(type)?.delete(handler),
    };
    const fire = (type: string, event: Record<string, unknown>) => {
      for (const handler of handlers.get(type) ?? []) handler(event);
    };
    const listeners = () => [...handlers.values()].reduce((sum, set) => sum + set.size, 0);
    // Подмена: watchBasemap пользуется только on и off.
    return { map: map as unknown as MapLibreMap, fire, listeners };
  }

  test('первый тайл нашего источника — «работает», отписка сразу', () => {
    const { map, fire, listeners } = fakeMap();
    const onStatus = vi.fn();
    watchBasemap(map, [IMAGERY_SOURCE], onStatus);

    fire('sourcedata', { dataType: 'source', sourceId: 'result', tile: {} });
    expect(onStatus).not.toHaveBeenCalled();
    fire('sourcedata', { dataType: 'source', sourceId: IMAGERY_SOURCE, tile: {} });

    expect(onStatus).toHaveBeenCalledExactlyOnceWith('ok');
    expect(listeners()).toBe(0);
  });

  test('три секунды одних ошибок — «недоступна»', () => {
    vi.useFakeTimers();
    const { map, fire } = fakeMap();
    const onStatus = vi.fn();
    watchBasemap(map, [IMAGERY_SOURCE], onStatus);

    fire('dataloading', { dataType: 'source', sourceId: IMAGERY_SOURCE, tile: {} });
    fire('error', { sourceId: IMAGERY_SOURCE, tile: {} });
    vi.advanceTimersByTime(BASEMAP_STATUS_DELAY_MS);

    expect(onStatus).toHaveBeenCalledExactlyOnceWith('unavailable');
  });

  test('ничего не запрошено — молчит', () => {
    vi.useFakeTimers();
    const { map } = fakeMap();
    const onStatus = vi.fn();
    watchBasemap(map, [IMAGERY_SOURCE], onStatus);

    vi.advanceTimersByTime(BASEMAP_STATUS_DELAY_MS * 2);

    expect(onStatus).not.toHaveBeenCalled();
  });
});

import { Notifications } from '@mantine/notifications';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as MapLibre from 'maplibre-gl';
import { AttributionControl, type StyleSpecification } from 'maplibre-gl';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type * as Config from '@/shared/config';
import { renderWithTheme } from '@/shared/lib/test';

import type * as BasemapStyle from './basemap-style';
import { MapView } from './map-view';

// В jsdom нет WebGL: вместо MapLibre — карта, которая принимает стиль, сообщает load и
// запоминает, какие слои переключали. Слой проекта добавлен к стилю, как это делает onReady.
const maps = vi.hoisted(() => ({
  webgl: true,
  created: [] as {
    style: StyleSpecification;
    visibility: Map<string, string>;
    controls: object[];
    emit: (type: string, event: unknown) => void;
  }[],
}));

vi.mock('maplibre-gl', async (importOriginal) => {
  const actual = await importOriginal<typeof MapLibre>();
  class FakeMap {
    listeners = new Map<string, Set<(event: unknown) => void>>();
    canvas = document.createElement('canvas');
    style: StyleSpecification;
    record;
    touchZoomRotate = { disableRotation: () => undefined };
    keyboard = { disableRotation: () => undefined };
    constructor({ style }: { style: StyleSpecification }) {
      if (!maps.webgl) throw new Error('GPUInitializationError');
      this.style = {
        ...style,
        layers: [...style.layers, { id: 'planting-trees', type: 'circle', source: 'planting' }],
      };
      this.record = {
        style: this.style,
        visibility: new Map<string, string>(),
        controls: [] as object[],
        emit: (type: string, event: unknown) => {
          for (const listener of this.listeners.get(type) ?? []) listener(event);
        },
      };
      maps.created.push(this.record);
      setTimeout(() => {
        this.record.emit('load', {});
      }, 0);
    }
    on(type: string, listener: (event: unknown) => void) {
      this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener));
      return this;
    }
    off(type: string, listener: (event: unknown) => void) {
      this.listeners.get(type)?.delete(listener);
      return this;
    }
    addControl(control: object) {
      this.record.controls.push(control);
      return this;
    }
    getStyle() {
      return this.style;
    }
    setLayoutProperty(id: string, _name: string, value: string) {
      this.record.visibility.set(id, value);
    }
    getCanvas() {
      return this.canvas;
    }
    fitBounds() {
      return this;
    }
    remove() {
      this.listeners.clear();
    }
  }
  return { ...actual, Map: FakeMap };
});

const archive = vi.hoisted((): { url: string | null } => ({
  url: 'http://localhost/basemap/moscow.pmtiles',
}));
vi.mock('./pmtiles-protocol', () => ({
  openBasemapArchive: () => Promise.resolve(archive.url),
}));
vi.mock('./basemap-style', async (importOriginal) => ({
  ...(await importOriginal<typeof BasemapStyle>()),
  loadLabelFont: () => Promise.resolve(),
}));

const IMAGERY = {
  tilesUrl: 'https://tiles.example.org/{z}/{y}/{x}',
  labelsUrl: 'https://tiles.example.org/labels/{z}/{y}/{x}',
  attribution: 'Источник снимка',
};
const configMock = vi.hoisted(() => ({ imagery: null as Config.ImageryConfig | null }));
vi.mock('@/shared/config', async (importOriginal) => {
  const actual = await importOriginal<typeof Config>();
  return {
    ...actual,
    getRuntimeConfig: () => ({
      ...actual.getRuntimeConfig(),
      basemapUrl: '/basemap/moscow.pmtiles',
      imagery: configMock.imagery,
    }),
  };
});

// eslint-disable-next-line no-restricted-properties -- выбор подложки лежит в хранилище сеанса: тест его читает и чистит
const storage = window.sessionStorage;

beforeEach(() => {
  archive.url = 'http://localhost/basemap/moscow.pmtiles';
  maps.webgl = true;
  maps.created = [];
  configMock.imagery = null;
});

afterEach(() => {
  storage.clear();
});

const renderMap = ({ basemapSwitch = true }: { basemapSwitch?: boolean } = {}) =>
  renderWithTheme(
    <>
      <Notifications />
      <MapView
        bounds={[37.64, 55.75, 37.65, 55.76]}
        padding={{ top: 0, right: 0, bottom: 0, left: 0 }}
        label="План посадок"
        basemap
        basemapVisible
        basemapSwitch={basemapSwitch}
        onReady={vi.fn()}
        onBasemapResolved={vi.fn()}
        onUnavailable={vi.fn()}
      />
    </>,
  );

const lastMap = () => {
  const map = maps.created.at(-1);
  if (map === undefined) throw new Error('карта не создана');
  return map;
};

const shownIds = () =>
  [...lastMap().visibility].filter(([, value]) => value === 'visible').map(([id]) => id);

describe('переключатель подложки', () => {
  test('без снимка в конфиге — «Схема» и «Светлая», по умолчанию «Схема»', async () => {
    renderMap();

    expect(await screen.findByRole('radio', { name: 'Схема' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Светлая' })).not.toBeChecked();
    expect(screen.queryByRole('radio', { name: 'Снимок' })).not.toBeInTheDocument();
  });

  test('со снимком — четыре подложки', async () => {
    configMock.imagery = IMAGERY;
    renderMap();

    const group = await screen.findByRole('radiogroup', { name: 'Подложка' });
    expect(group).toHaveTextContent('СхемаСветлаяСнимокСнимок с подписями');
  });

  test('переключение меняет только слои подложки: слои проекта не трогаются', async () => {
    configMock.imagery = IMAGERY;
    renderMap();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('radio', { name: 'Светлая' }));

    await waitFor(() => {
      expect(shownIds().every((id) => id.startsWith('light:'))).toBe(true);
    });
    expect(shownIds().length).toBeGreaterThan(10);
    expect(lastMap().visibility.has('planting-trees')).toBe(false);
    expect(lastMap().visibility.get('roads_major')).toBe('none');

    await user.click(screen.getByRole('radio', { name: 'Снимок с подписями' }));
    await waitFor(() => {
      expect(shownIds()).toEqual(['imagery', 'imagery-labels']);
    });
    expect(lastMap().visibility.has('planting-trees')).toBe(false);
    // Порядок слоёв стиля не меняется: переключение — только видимость.
    expect(lastMap().style.layers.at(-1)?.id).toBe('planting-trees');
  });

  test('атрибуция — у источника выбранной подложки: MapLibre показывает её по видимым слоям', async () => {
    configMock.imagery = IMAGERY;
    renderMap();
    await screen.findByRole('radio', { name: 'Схема' });

    const { sources } = lastMap().style;
    expect(lastMap().controls.some((control) => control instanceof AttributionControl)).toBe(true);
    expect(sources.basemap).toMatchObject({ attribution: '© участники OpenStreetMap, Protomaps' });
    expect(sources.imagery).toMatchObject({ attribution: 'Источник снимка' });
    expect(sources['imagery-labels']).not.toHaveProperty('attribution');
    // «Светлая» — слои того же источника: атрибуция та же.
    expect(
      lastMap()
        .style.layers.filter(({ id }) => id.startsWith('light:') && id !== 'light:background')
        .every((layer) => 'source' in layer && layer.source === 'basemap'),
    ).toBe(true);
  });

  test('выбор помнится: следующая карта открывается с ним', async () => {
    renderMap();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('radio', { name: 'Светлая' }));

    renderMap();

    const radios = await screen.findAllByRole('radio', { name: 'Светлая' });
    expect(radios.at(-1)).toBeChecked();
  });

  test('без архива «Светлой» нет; запомненная «Светлая» показывается «Схемой»', async () => {
    configMock.imagery = IMAGERY;
    archive.url = null;
    storage.setItem('greenleaders.basemap', 'light');
    renderMap();

    expect(await screen.findByRole('radio', { name: 'Схема' })).toBeChecked();
    expect(screen.queryByRole('radio', { name: 'Светлая' })).not.toBeInTheDocument();
  });

  test('без WebGL переключателя нет', async () => {
    maps.webgl = false;
    renderMap();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('radiogroup', { name: 'Подложка' })).not.toBeInTheDocument();
  });

  test('без basemapSwitch переключателя нет, снимка в стиле нет', async () => {
    configMock.imagery = IMAGERY;
    renderMap({ basemapSwitch: false });

    await waitFor(() => {
      expect(maps.created).toHaveLength(1);
    });
    expect(screen.queryByRole('radiogroup', { name: 'Подложка' })).not.toBeInTheDocument();
    expect(lastMap().style.sources).not.toHaveProperty('imagery');
  });

  test('снимок не прислал ни одного тайла за три секунды — уведомление с источником', async () => {
    configMock.imagery = IMAGERY;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderMap();
      const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
      await user.click(await screen.findByRole('radio', { name: 'Снимок' }));
      act(() => {
        lastMap().emit('dataloading', { sourceId: 'imagery', tile: {}, dataType: 'source' });
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

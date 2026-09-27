import { screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { renderWithTheme } from '@/shared/lib/test';

import type * as BasemapStyle from './basemap-style';
import { MapView } from './map-view';

const archive = vi.hoisted(() => ({ url: null as string | null, opened: 0 }));
const font = vi.hoisted(() => ({ loaded: Promise.resolve() }));

vi.mock('./pmtiles-protocol', () => ({
  openBasemapArchive: () => {
    archive.opened += 1;
    return Promise.resolve(archive.url);
  },
}));
vi.mock('./basemap-style', async (importOriginal) => ({
  ...(await importOriginal<typeof BasemapStyle>()),
  loadLabelFont: () => font.loaded,
}));

beforeEach(() => {
  archive.url = null;
  archive.opened = 0;
  font.loaded = Promise.resolve();
});

const renderMap = ({ basemap = true, note }: { basemap?: boolean; note?: string } = {}) => {
  const handlers = { onUnavailable: vi.fn(), onReady: vi.fn(), onBasemapResolved: vi.fn() };
  renderWithTheme(
    <MapView
      bounds={[37.64, 55.75, 37.65, 55.76]}
      padding={{ top: 0, right: 0, bottom: 0, left: 0 }}
      label="План посадок"
      basemap={basemap}
      basemapVisible
      note={note}
      {...handlers}
    />,
  );
  return handlers;
};

// В jsdom нет WebGL (getContext → null), как на рабочем месте без GPU: конструктор MapLibre
// бросает GPUInitializationError. Компонент не должен пропустить её наружу.
test('без WebGL — сообщает потребителю, а не падает', async () => {
  const { onUnavailable, onReady, onBasemapResolved } = renderMap();

  await waitFor(() => {
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });
  expect(onReady).not.toHaveBeenCalled();
  expect(onBasemapResolved).toHaveBeenCalledWith(false);
  expect(screen.getByText('Подложка не загружена')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Приблизить' })).toBeDisabled();
});

test('шрифт подписей не загрузился — карта всё равно создаётся', async () => {
  archive.url = 'http://localhost/basemap/moscow.pmtiles';
  font.loaded = Promise.reject(new DOMException('font', 'NetworkError'));
  const { onUnavailable } = renderMap();

  await waitFor(() => {
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });
});

// Попытка создать карту видна по onUnavailable: без WebGL конструктор бросает сразу.
test('с подложкой карта создаётся только после загрузки шрифта подписей', async () => {
  archive.url = 'http://localhost/basemap/moscow.pmtiles';
  let resolveFont: (() => void) | undefined;
  font.loaded = new Promise<void>((resolve) => {
    resolveFont = resolve;
  });
  const { onUnavailable } = renderMap();

  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(onUnavailable).not.toHaveBeenCalled();

  resolveFont?.();
  await waitFor(() => {
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });
});

test('координаты чертежа: подложка не запрашивается, в углу — подпись, шрифт подписей ждём', async () => {
  let resolveFont: (() => void) | undefined;
  font.loaded = new Promise<void>((resolve) => {
    resolveFont = resolve;
  });
  const { onUnavailable } = renderMap({
    basemap: false,
    note: 'Координаты чертежа, без привязки к городу',
  });

  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(onUnavailable).not.toHaveBeenCalled();
  resolveFont?.();

  await waitFor(() => {
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });
  expect(archive.opened).toBe(0);
  expect(screen.getByText('Координаты чертежа, без привязки к городу')).toBeInTheDocument();
  expect(screen.queryByText('Подложка не загружена')).not.toBeInTheDocument();
});

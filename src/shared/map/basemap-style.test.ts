import type { LayerSpecification } from 'maplibre-gl';
import { describe, expect, test, vi } from 'vitest';

import { basemapColors } from '@/shared/theme';

import { BASEMAP_SOURCE, basemapLayers, basemapStyle, loadStreetLabelFont } from './basemap-style';

const COLOR = /^(#|rgba?\(|hsla?\()/i;

// Все цветовые литералы в paint, включая ветки выражений.
function colorsOf(value: unknown): string[] {
  if (typeof value === 'string') return COLOR.test(value) ? [value.toUpperCase()] : [];
  if (Array.isArray(value)) return value.flatMap(colorsOf);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(colorsOf);
  return [];
}

const layerById = (id: string): LayerSpecification => {
  const layer = basemapLayers().find((candidate) => candidate.id === id);
  if (layer === undefined) throw new Error(`нет слоя ${id}`);
  return layer;
};

describe('basemapStyle', () => {
  test('цвета подложки — только из темы', () => {
    const allowed = new Set(Object.values(basemapColors).map((color) => color.toUpperCase()));
    const used = new Set(basemapLayers().flatMap((layer) => colorsOf(layer.paint)));

    expect([...used].filter((color) => !allowed.has(color))).toEqual([]);
    expect(used).toContain(basemapColors.earth.toUpperCase());
    expect(used).toContain(basemapColors.water.toUpperCase());
  });

  test('нет POI, границ и подписей, кроме улиц', () => {
    const ids = basemapLayers().map((layer) => layer.id);
    const symbols = basemapLayers().filter((layer) => layer.type === 'symbol');

    expect(ids.filter((id) => /^(pois|boundaries|places)/.test(id))).toEqual([]);
    expect(symbols.map((layer) => layer.id).sort()).toEqual([
      'roads_labels_major',
      'roads_labels_minor',
    ]);
  });

  test.each(['roads_labels_minor', 'roads_labels_major'])(
    '%s — Mulish капсом с трекингом и ореолом',
    (id) => {
      const layer = layerById(id);
      if (layer.type !== 'symbol') throw new Error('ожидался symbol');

      expect(layer.layout).toMatchObject({
        'text-font': ['Mulish Variable SemiBold', 'Mulish Variable'],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.06,
      });
      expect(layer.paint).toMatchObject({
        'text-color': basemapColors.streetLabel,
        'text-halo-color': basemapColors.streetLabelHalo,
        'text-halo-width': 1,
      });
    },
  );

  test('здания — заливка и обводка из design.md', () => {
    expect(layerById('buildings').paint).toMatchObject({
      'fill-color': basemapColors.buildings,
      'fill-outline-color': basemapColors.buildingsOutline,
      'fill-opacity': 1,
    });
  });

  test('подписи рисуются в браузере шрифтом интерфейса: без glyphs и font-faces', () => {
    const style = basemapStyle('http://localhost/basemap/moscow.pmtiles');

    expect(style.glyphs).toBeUndefined();
    expect(style['font-faces']).toBeUndefined();
    expect(style.sources[BASEMAP_SOURCE]).toEqual({
      type: 'vector',
      url: 'pmtiles://http://localhost/basemap/moscow.pmtiles',
    });
  });

  test('без архива — только фон «Земля»', () => {
    const style = basemapStyle(null);

    expect(style.sources).toEqual({});
    expect(style.layers).toEqual([
      { id: 'background', type: 'background', paint: { 'background-color': basemapColors.earth } },
    ]);
  });
});

test('шрифт подписей: начертание 600 для латиницы и кириллицы', async () => {
  const load = vi.fn(() => Promise.resolve([]));
  Object.defineProperty(document.fonts, 'load', { configurable: true, value: load });

  try {
    await loadStreetLabelFont();

    expect(load).toHaveBeenCalledWith('600 16px "Mulish Variable"', 'Aa');
    expect(load).toHaveBeenCalledWith('600 16px "Mulish Variable"', 'Аа');
  } finally {
    Reflect.deleteProperty(document.fonts, 'load');
  }
});

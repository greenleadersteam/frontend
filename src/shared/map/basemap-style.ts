import { type Flavor, layers, namedFlavor } from '@protomaps/basemaps';
import type { LayerSpecification, SourceSpecification, StyleSpecification } from 'maplibre-gl';

import type { ImageryConfig } from '@/shared/config';
import { basemapColors as colors, MAP_LABEL_FONT } from '@/shared/theme';

import {
  BASEMAP_SOURCE,
  IMAGERY_LABELS_SOURCE,
  IMAGERY_NATIVE_ZOOM,
  IMAGERY_SOURCE,
  IMAGERY_SOURCES,
  LIGHT_LAYER_PREFIX,
  SCHEME_ATTRIBUTION,
} from './basemaps';

// Подписи рисуются в браузере шрифтом интерфейса, уже загруженным из
// @fontsource-variable/mulish: без glyphs и font-faces MapLibre растеризует глифы локально.
// font-faces не подходит: файл из него рисуется только весом 400.
const FONT = 'Mulish Variable';

// Глиф растеризуется один раз и кэшируется: если начертание к этому моменту не загружено,
// подпись навсегда останется запасным шрифтом. Подписи — у улиц подложки и у размерных линий.
// Образцы текста выбирают по unicode-range файлы подмножеств latin и cyrillic.
export async function loadLabelFont(): Promise<void> {
  await Promise.all(
    ['Aa', 'Аа'].map((sample) => document.fonts.load(`600 16px "${FONT}"`, sample)),
  );
}

// Цвета — design.md, «Карта». Классы, которых нет в таблице, приведены к ближайшей роли:
// аэродромы и военные территории — кварталы, пляжи и пески — земля, железные дороги — обводка дорог.
const FLAVOR: Flavor = {
  background: colors.earth,
  earth: colors.earth,
  park_a: colors.parks,
  park_b: colors.parks,
  wood_a: colors.parks,
  wood_b: colors.parks,
  scrub_a: colors.parks,
  scrub_b: colors.parks,
  zoo: colors.parks,
  hospital: colors.blocks,
  industrial: colors.blocks,
  school: colors.blocks,
  pedestrian: colors.blocks,
  military: colors.blocks,
  aerodrome: colors.blocks,
  pier: colors.blocks,
  glacier: colors.earth,
  sand: colors.earth,
  beach: colors.earth,
  runway: colors.roads,
  water: colors.water,
  buildings: colors.buildings,
  railway: colors.roadsCasing,
  boundaries: colors.roadsCasing,

  tunnel_other_casing: colors.tunnelsCasing,
  tunnel_minor_casing: colors.tunnelsCasing,
  tunnel_link_casing: colors.tunnelsCasing,
  tunnel_major_casing: colors.tunnelsCasing,
  tunnel_highway_casing: colors.tunnelsCasing,
  tunnel_other: colors.tunnels,
  tunnel_minor: colors.tunnels,
  tunnel_link: colors.tunnels,
  tunnel_major: colors.tunnels,
  tunnel_highway: colors.tunnels,

  minor_service_casing: colors.roadsCasing,
  minor_casing: colors.roadsCasing,
  link_casing: colors.roadsCasing,
  major_casing_late: colors.roadsCasing,
  highway_casing_late: colors.roadsCasing,
  major_casing_early: colors.roadsCasing,
  highway_casing_early: colors.roadsCasing,
  other: colors.roads,
  minor_service: colors.roads,
  minor_a: colors.roads,
  minor_b: colors.roads,
  link: colors.roads,
  major: colors.roads,
  highway: colors.roads,

  bridges_other_casing: colors.roadsCasing,
  bridges_minor_casing: colors.roadsCasing,
  bridges_link_casing: colors.roadsCasing,
  bridges_major_casing: colors.roadsCasing,
  bridges_highway_casing: colors.roadsCasing,
  bridges_other: colors.roads,
  bridges_minor: colors.roads,
  bridges_link: colors.roads,
  bridges_major: colors.roads,
  bridges_highway: colors.roads,

  roads_label_minor: colors.streetLabel,
  roads_label_minor_halo: colors.streetLabelHalo,
  roads_label_major: colors.streetLabel,
  roads_label_major_halo: colors.streetLabelHalo,
  // Остальные подписи удаляются после генерации; Flavor требует для них значения.
  ocean_label: colors.streetLabel,
  subplace_label: colors.streetLabel,
  subplace_label_halo: colors.streetLabelHalo,
  city_label: colors.streetLabel,
  city_label_halo: colors.streetLabelHalo,
  state_label: colors.streetLabel,
  state_label_halo: colors.streetLabelHalo,
  country_label: colors.streetLabel,
  address_label: colors.streetLabel,
  address_label_halo: colors.streetLabelHalo,

  regular: FONT,
  bold: FONT,
  italic: FONT,
  // pois и landcover не заданы: слои POI и растительного покрова тогда не создаются.
};

// «Светлая» — готовая белая палитра Protomaps: нейтральный фон, на котором читается только план.
// Шрифты — те же, что у «Схемы»; POI и растительного покрова нет, как и там.
const LIGHT_FLAVOR: Flavor = {
  ...namedFlavor('white'),
  pois: undefined,
  landcover: undefined,
  regular: FONT,
  bold: FONT,
  italic: FONT,
};

const STREET_LABELS = new Set(['roads_labels_minor', 'roads_labels_major']);

// Из подписей остаются только улицы, границы не показываются (design.md, «Карта»).
const isKept = (layer: LayerSpecification): boolean =>
  layer.type === 'symbol' ? STREET_LABELS.has(layer.id) : !layer.id.startsWith('boundaries');

// Правки, которых Flavor не даёт: обводка зданий и оформление подписей улиц.
function refine(layer: LayerSpecification): LayerSpecification {
  if (layer.id === 'buildings' && layer.type === 'fill') {
    return {
      ...layer,
      paint: { ...layer.paint, 'fill-opacity': 1, 'fill-outline-color': colors.buildingsOutline },
    };
  }
  return refineLabels(layer);
}

function refineLabels(layer: LayerSpecification): LayerSpecification {
  if (STREET_LABELS.has(layer.id) && layer.type === 'symbol') {
    return {
      ...layer,
      layout: {
        ...layer.layout,
        'text-font': MAP_LABEL_FONT,
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.06,
      },
      paint: { ...layer.paint, 'text-halo-width': 1 },
    };
  }
  return layer;
}

export const basemapLayers = (): LayerSpecification[] =>
  layers(BASEMAP_SOURCE, FLAVOR, { lang: 'ru' }).filter(isKept).map(refine);

// Скрыты по умолчанию: какую подложку показать, решает MapView.
export const lightLayers = (): LayerSpecification[] =>
  layers(BASEMAP_SOURCE, LIGHT_FLAVOR, { lang: 'ru' })
    .filter(isKept)
    .map(refineLabels)
    .map((layer) => ({
      ...layer,
      id: `${LIGHT_LAYER_PREFIX}${layer.id}`,
      layout: { ...layer.layout, visibility: 'none' },
    }));

// AttributionControl MapLibre вставляет атрибуцию как HTML, а строка снимка приходит из конфига
// контура — недоверенные данные (security.md): выводится только текстом.
const escapeHtml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

// Снимок и подписи к нему — растровые слои под всеми остальными, по умолчанию скрыты: какую
// подложку показать, решает MapView. Атрибуция — у источника: MapLibre показывает её, только
// пока слой источника виден.
function imagerySources(imagery: ImageryConfig): Record<string, SourceSpecification> {
  const raster = (url: string, attribution?: string): SourceSpecification => ({
    type: 'raster',
    tiles: [url],
    tileSize: 256,
    maxzoom: IMAGERY_NATIVE_ZOOM,
    ...(attribution !== undefined && { attribution: escapeHtml(attribution) }),
  });
  return {
    [IMAGERY_SOURCE]: raster(imagery.tilesUrl, imagery.attribution),
    [IMAGERY_LABELS_SOURCE]: raster(imagery.labelsUrl),
  };
}

const imageryLayers = (): LayerSpecification[] =>
  IMAGERY_SOURCES.map((source) => ({
    id: source,
    type: 'raster',
    source,
    layout: { visibility: 'none' },
  }));

// Без архива — однотонная «Земля»: слои результата ложатся на неё так же, как на подложку.
export function basemapStyle(
  archiveUrl: string | null,
  imagery: ImageryConfig | null = null,
): StyleSpecification {
  const background: LayerSpecification = {
    id: 'background',
    type: 'background',
    paint: { 'background-color': colors.earth },
  };
  const imageryPart =
    imagery === null
      ? { sources: {}, layers: [] }
      : {
          sources: imagerySources(imagery),
          layers: imageryLayers(),
        };
  if (archiveUrl === null) {
    return {
      version: 8,
      sources: imageryPart.sources,
      layers: [background, ...imageryPart.layers],
    };
  }
  const [base, ...rest] = basemapLayers();
  const [lightBase, ...lightRest] = lightLayers();
  return {
    version: 8,
    sources: {
      [BASEMAP_SOURCE]: {
        type: 'vector',
        url: `pmtiles://${archiveUrl}`,
        attribution: SCHEME_ATTRIBUTION,
      },
      ...imageryPart.sources,
    },
    // Снимок — над фонами схем, под их остальными слоями: схемы и снимок видны порознь, слои
    // проекта ложатся поверх всех.
    layers: [
      ...[base, lightBase].filter((layer) => layer !== undefined),
      ...imageryPart.layers,
      ...rest,
      ...lightRest,
    ],
  };
}

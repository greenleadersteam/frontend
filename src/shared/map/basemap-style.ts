import { type Flavor, layers } from '@protomaps/basemaps';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

import { basemapColors as colors } from '@/shared/theme';

export const BASEMAP_SOURCE = 'basemap';

// Подписи рисуются в браузере шрифтом интерфейса, уже загруженным из
// @fontsource-variable/mulish: без glyphs и font-faces MapLibre растеризует глифы локально
// шрифтами из text-font, а вес берёт из имени первого из них (SemiBold → 600).
// font-faces не подходит: файл из него рисуется только весом 400.
const STREET_LABEL_FONT = ['Mulish Variable SemiBold', 'Mulish Variable'];
const FONT = 'Mulish Variable';

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
  if (STREET_LABELS.has(layer.id) && layer.type === 'symbol') {
    return {
      ...layer,
      layout: {
        ...layer.layout,
        'text-font': STREET_LABEL_FONT,
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

// Без архива — однотонная «Земля»: слои результата ложатся на неё так же, как на подложку.
export function basemapStyle(archiveUrl: string | null): StyleSpecification {
  if (archiveUrl === null) {
    return {
      version: 8,
      sources: {},
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': colors.earth } },
      ],
    };
  }
  return {
    version: 8,
    sources: { [BASEMAP_SOURCE]: { type: 'vector', url: `pmtiles://${archiveUrl}` } },
    layers: basemapLayers(),
  };
}

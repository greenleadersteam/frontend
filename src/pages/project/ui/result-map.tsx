import { ActionIcon, Popover, Skeleton, Text } from '@mantine/core';
import { useElementSize, useMediaQuery, useWindowEvent } from '@mantine/hooks';
import { IconStack2 } from '@tabler/icons-react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { type JSX, lazy, Suspense, useEffect, useRef, useState } from 'react';

import {
  HATCH_IMAGE,
  hatchPattern,
  type PlantingFeatureCollection,
  RESULT_LAYER_GROUPS,
  RESULT_SOURCE,
  resultCounts,
  resultExtent,
  resultLayers,
  resultSources,
  SELECTABLE_LAYERS,
  type ZonesFeatureCollection,
} from '@/entities/project';
import { Icon } from '@/shared/ui';

import { LayersPanel, type LayerVisibility } from './layers-panel';
import { PlantingPanel } from './planting-panel';
import { resultLabel } from './result-label';
import classes from './result-map.module.css';

// maplibre-gl, его стили, pmtiles и стиль подложки грузятся, только когда карта показывается.
const MapView = lazy(async () => ({ default: (await import('@/shared/map')).MapView }));

// Узкий экран — панель «Слои» сворачивается в кнопку, панель «Посадка» уходит под карту.
const NARROW_QUERY = '(max-width: 56.25em)';
// Поля вписывания в пикселях: от края карты до участка, справа — место под кнопки масштаба.
const FIT_GAP_PX = 32;
const ZOOM_CONTROLS_PX = 72;

type ResultMapProps = {
  planting: PlantingFeatureCollection;
  zones: ZonesFeatureCollection;
  onUnavailable: () => void;
};

export function ResultMap({ planting, zones, onUnavailable }: ResultMapProps): JSX.Element {
  const data = { planting, zones };
  const extent = resultExtent(data);
  const counts = resultCounts(data);
  const narrow = useMediaQuery(NARROW_QUERY);
  const { ref: layersRef, width: layersWidth } = useElementSize();

  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [visibility, setVisibility] = useState<LayerVisibility>({
    trees: true,
    shrubs: true,
    zones: true,
    basemap: true,
  });
  const [basemapAvailable, setBasemapAvailable] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Если фокус был в панели, он исчез бы вместе с ней: возвращаем его на карту.
  const closePanel = (returnFocus: boolean) => {
    setSelectedId(null);
    if (returnFocus) map?.getCanvas().focus();
  };

  // Esc закрывает панель, только когда фокус на карте или в её панелях. Открытый список
  // или поповер закрывают себя сами, не останавливая событие: их Esc выбор не снимает.
  // Фаза захвата на window идёт раньше обработчиков React, поэтому aria-expanded ещё
  // показывает, был ли список открыт в момент нажатия.
  useWindowEvent(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || selectedId === null) return;
      const focused = document.activeElement;
      const inPanel = panelRef.current?.contains(focused) === true;
      const expanded =
        event.target instanceof Element && event.target.closest('[aria-expanded="true"]') !== null;
      if ((inPanel || areaRef.current?.contains(focused) === true) && !expanded) {
        closePanel(inPanel);
      }
    },
    { capture: true },
  );

  useEffect(() => {
    if (map === null) return;
    for (const group of ['trees', 'shrubs', 'zones'] as const) {
      for (const layer of RESULT_LAYER_GROUPS[group]) {
        map.setLayoutProperty(layer, 'visibility', visibility[group] ? 'visible' : 'none');
      }
    }
  }, [map, visibility]);

  // Выделение — feature-state по id посадки: источник не пересоздаётся.
  useEffect(() => {
    if (map === null) return;
    const previous = selectedRef.current;
    if (previous !== null) {
      map.setFeatureState({ source: RESULT_SOURCE.planting, id: previous }, { selected: false });
    }
    if (selectedId !== null) {
      map.setFeatureState({ source: RESULT_SOURCE.planting, id: selectedId }, { selected: true });
    }
    selectedRef.current = selectedId;
  }, [map, selectedId]);

  if (extent === null) {
    return <Text className={classes.area}>В результате обработки нет посадок и зон запрета.</Text>;
  }
  const latitude = (extent.minY + extent.maxY) / 2;

  const addResult = (target: MapLibreMap) => {
    const pixelRatio = target.getPixelRatio();
    target.addImage(HATCH_IMAGE, hatchPattern(pixelRatio), { pixelRatio });
    for (const [id, source] of Object.entries(resultSources(data, latitude))) {
      target.addSource(id, source);
    }
    for (const layer of resultLayers(latitude)) target.addLayer(layer);

    // Клик по пустому месту снимает выделение.
    target.on('click', (event) => {
      const [feature] = target.queryRenderedFeatures(event.point, { layers: SELECTABLE_LAYERS });
      const id: unknown = feature?.properties.id;
      setSelectedId(typeof id === 'string' ? id : null);
    });
    for (const layer of SELECTABLE_LAYERS) {
      target.on('mouseenter', layer, () => {
        target.getCanvas().style.cursor = 'pointer';
      });
      target.on('mouseleave', layer, () => {
        target.getCanvas().style.cursor = '';
      });
    }
    setMap(target);
  };

  const selected = planting.features.find(({ properties }) => properties.id === selectedId);

  // Выбор из списка — путь для клавиатуры и скринридера: карта подводится к посадке.
  const selectFromList = (id: string | null) => {
    setSelectedId(id);
    const feature = planting.features.find(({ properties }) => properties.id === id);
    const [lon, lat] = feature?.geometry.coordinates ?? [];
    if (map !== null && lon !== undefined && lat !== undefined) {
      // При prefers-reduced-motion MapLibre сам переходит без анимации.
      map.easeTo({ center: [lon, lat] });
    }
  };

  const changeVisibility = (next: LayerVisibility) => {
    setVisibility(next);
    // Скрытая посадка не остаётся выбранной: кольца висели бы над пустым местом.
    const group = selected?.properties.plant_type === 'tree' ? 'trees' : 'shrubs';
    if (selected !== undefined && !next[group]) setSelectedId(null);
  };

  const plantingPanel = selected !== undefined && (
    <PlantingPanel
      planting={selected.properties}
      onClose={() => {
        closePanel(true);
      }}
    />
  );
  const layersPanel = (
    <LayersPanel
      counts={counts}
      visibility={visibility}
      basemapAvailable={basemapAvailable}
      onChange={changeVisibility}
      planting={planting}
      selectedId={selectedId}
      onSelect={selectFromList}
      inPopover={narrow}
    />
  );

  return (
    <>
      <div ref={areaRef} className={classes.area}>
        <Suspense fallback={<Skeleton className={classes.fill} radius="xl" />}>
          <MapView
            bounds={[extent.minX, extent.minY, extent.maxX, extent.maxY]}
            padding={{
              top: FIT_GAP_PX,
              bottom: FIT_GAP_PX,
              left: (narrow ? 0 : layersWidth) + FIT_GAP_PX,
              right: ZOOM_CONTROLS_PX,
            }}
            label={resultLabel(data)}
            basemapVisible={visibility.basemap}
            onReady={addResult}
            onBasemapResolved={setBasemapAvailable}
            onUnavailable={onUnavailable}
          >
            <div className={classes.topLeft}>
              {narrow ? (
                <Popover position="bottom-start" shadow="md">
                  <Popover.Target>
                    <ActionIcon variant="default" size="lg" aria-label="Слои">
                      <Icon icon={IconStack2} />
                    </ActionIcon>
                  </Popover.Target>
                  <Popover.Dropdown>{layersPanel}</Popover.Dropdown>
                </Popover>
              ) : (
                <div ref={layersRef} className={classes.panel}>
                  {layersPanel}
                </div>
              )}
            </div>
            {!narrow && plantingPanel !== false && (
              <div className={classes.topRight}>
                <div ref={panelRef} className={classes.panel}>
                  {plantingPanel}
                </div>
              </div>
            )}
          </MapView>
        </Suspense>
      </div>
      {narrow && plantingPanel !== false && (
        <div ref={panelRef} className={classes.below}>
          {plantingPanel}
        </div>
      )}
    </>
  );
}

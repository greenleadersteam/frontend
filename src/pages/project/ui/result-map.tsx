import { ActionIcon, Popover, Skeleton } from '@mantine/core';
import { useElementSize, useMediaQuery, useWindowEvent } from '@mantine/hooks';
import { IconStack2 } from '@tabler/icons-react';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { type JSX, lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from 'react';

import {
  checksForPlanting,
  dimensionLabelsMinZoom,
  dimensionLines,
  type ExplanationEntry,
  HATCH_IMAGE,
  hatchPattern,
  type LocalFrame,
  pixelsPerMeterAtZoom,
  type PlantingCheck,
  type PlantingFeatureCollection,
  type PreparedZones,
  RESULT_LAYER,
  RESULT_LAYER_GROUPS,
  RESULT_SOURCE,
  resultCounts,
  type ResultData,
  resultLayers,
  resultSources,
  SELECTABLE_LAYERS,
} from '@/entities/project';
import { Icon } from '@/shared/ui';

import { LayersPanel, type LayerVisibility } from './layers-panel';
import { PlantingPanel } from './planting-panel';
import { resultLabel } from './result-label';
import classes from './result-map.module.css';
import { ZonePanel } from './zone-panel';

// maplibre-gl, его стили, pmtiles и стиль подложки грузятся, только когда карта показывается.
const MapView = lazy(async () => ({ default: (await import('@/shared/map')).MapView }));

// Узкий экран — панель «Слои» сворачивается в кнопку, панель «Посадка» уходит под карту.
const NARROW_QUERY = '(max-width: 56.25em)';
// Поля вписывания в пикселях: от края карты до участка, справа — место под кнопки масштаба.
const FIT_GAP_PX = 32;
const ZOOM_CONTROLS_PX = 72;
const DRAWING_NOTE = 'Координаты чертежа, без привязки к городу';
const OUTSIDE_BASEMAP_NOTE = 'Участок за пределами карты Москвы, подложки нет';

export type Selection = { kind: 'planting'; id: string } | { kind: 'zone'; index: number } | null;

// Просьба подвести камеру к посадке (из ведомости). nonce различает повторы для той же посадки.
export type CenterRequest = { id: string; nonce: number };

type ResultMapProps = {
  // Данные бэкенда: по ним считаются проверки.
  data: ResultData;
  // Те же данные в координатах карты.
  mapData: ResultData;
  // Охват в координатах карты: [запад, юг, восток, север].
  bounds: [number, number, number, number];
  frame: LocalFrame;
  prepared: PreparedZones;
  explanation: ReadonlyMap<string, ExplanationEntry>;
  // Подложка есть только у проекта с геопривязкой в пределах карты Москвы.
  basemap: boolean;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  centerRequest: CenterRequest | null;
  // План на экране, а не скрыт ведомостью.
  visible: boolean;
  onUnavailable: () => void;
};

// Проверки считаются по данным бэкенда, не по координатам карты: у плана без геопривязки
// координаты карты условные.
const plantingChecks = (
  feature: PlantingFeatureCollection['features'][number] | undefined,
  frame: LocalFrame,
  prepared: PreparedZones,
): PlantingCheck[] =>
  feature === undefined
    ? []
    : checksForPlanting(
        frame.toLocal(feature.geometry.coordinates),
        feature.properties.plant_type,
        prepared,
      );

export function ResultMap({
  data,
  mapData,
  bounds,
  frame,
  prepared,
  explanation,
  basemap,
  selection,
  onSelect,
  centerRequest,
  visible,
  onUnavailable,
}: ResultMapProps): JSX.Element {
  const geographic = frame.geographic;
  const latitude = (bounds[1] + bounds[3]) / 2;
  const counts = resultCounts(data);
  const narrow = useMediaQuery(NARROW_QUERY);
  const { ref: layersRef, width: layersWidth } = useElementSize();

  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [zoom, setZoom] = useState(0);
  const [visibility, setVisibility] = useState<LayerVisibility>({
    trees: true,
    shrubs: true,
    zones: true,
    basemap: true,
  });
  const [basemapAvailable, setBasemapAvailable] = useState(false);
  // Выделенное ограничение привязано к выбранной посадке: смена выбора его сбрасывает.
  const [focused, setFocused] = useState<{ selection: Selection; index: number } | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Панель открыта из другой панели: кнопка, на которой был фокус, исчезла вместе с ней, и
  // фокус переходит в новую панель, иначе он ушёл бы на body.
  const focusPanelRef = useRef(false);
  const openedPanelRef = useRef<HTMLDivElement>(null);
  const plantingRef = useRef<string | null>(null);
  const zoneRef = useRef<number | null>(null);

  const selectedPlanting =
    selection?.kind === 'planting'
      ? data.planting.features.find(({ properties }) => properties.id === selection.id)
      : undefined;
  const selectedZone = selection?.kind === 'zone' ? prepared.zones[selection.index] : undefined;
  const checks = plantingChecks(selectedPlanting, frame, prepared);
  const focusedCheck = focused?.selection === selection ? focused.index : null;

  // Если фокус был в панели, он исчез бы вместе с ней: возвращаем его на карту.
  const closePanel = (returnFocus: boolean) => {
    onSelect(null);
    if (returnFocus) map?.getCanvas().focus();
  };

  // Esc закрывает панель, только когда фокус на карте или в её панелях. Открытый список
  // или поповер закрывают себя сами, не останавливая событие: их Esc выбор не снимает.
  // Фаза захвата на window идёт раньше обработчиков React, поэтому aria-expanded ещё
  // показывает, был ли список открыт в момент нажатия.
  useWindowEvent(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || selection === null) return;
      const active = document.activeElement;
      const inPanel = panelRef.current?.contains(active) === true;
      const expanded =
        event.target instanceof Element && event.target.closest('[aria-expanded="true"]') !== null;
      if ((inPanel || areaRef.current?.contains(active) === true) && !expanded) {
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

  // Выделение — feature-state по id посадки и номеру зоны: источники не пересоздаются.
  useEffect(() => {
    if (map === null) return;
    const plantingId = selection?.kind === 'planting' ? selection.id : null;
    const zoneIndex = selection?.kind === 'zone' ? selection.index : null;
    if (plantingRef.current !== null) {
      map.setFeatureState(
        { source: RESULT_SOURCE.planting, id: plantingRef.current },
        { selected: false },
      );
    }
    if (zoneRef.current !== null) {
      map.setFeatureState(
        { source: RESULT_SOURCE.zones, id: zoneRef.current },
        { selected: false },
      );
    }
    if (plantingId !== null) {
      map.setFeatureState({ source: RESULT_SOURCE.planting, id: plantingId }, { selected: true });
    }
    if (zoneIndex !== null) {
      map.setFeatureState({ source: RESULT_SOURCE.zones, id: zoneIndex }, { selected: true });
    }
    plantingRef.current = plantingId;
    zoneRef.current = zoneIndex;
  }, [map, selection]);

  // Размерные линии выбранной посадки; засечки пересчитываются с масштабом. Проверки
  // посчитаны при рендере, React Compiler не пересчитывает их без смены выбора.
  useEffect(() => {
    const lines = dimensionLines(checks, frame, {
      focused: focusedCheck,
      metersPerPixel: 1 / pixelsPerMeterAtZoom(zoom, latitude),
    });
    void map?.getSource<GeoJSONSource>(RESULT_SOURCE.dimensions)?.setData(lines);
  }, [map, checks, frame, focusedCheck, zoom, latitude]);

  // Переход из ведомости: камера подводится к посадке, когда план уже показан. Вид меняется
  // через URL позже, чем выбор, а ResizeObserver MapLibre сообщит новый размер ещё позже:
  // без resize() центр считался бы по скрытому контейнеру. Масштаб — не мельче того, где
  // видны подписи размерных линий. При prefers-reduced-motion MapLibre переходит без анимации.
  const centeredRef = useRef<number | null>(null);
  const centerOn = useEffectEvent((target: MapLibreMap, id: string) => {
    const feature = mapData.planting.features.find(({ properties }) => properties.id === id);
    if (feature === undefined) return;
    const [lon, lat] = feature.geometry.coordinates;
    if (lon === undefined || lat === undefined) return;
    // Посадку на выключенном слое не выбрать: кольца висели бы над пустым местом.
    const group = feature.properties.plant_type === 'tree' ? 'trees' : 'shrubs';
    setVisibility((previous) => ({ ...previous, [group]: true }));
    // Строка ведомости, с которой пришёл фокус, скрыта вместе с ведомостью.
    openedPanelRef.current?.focus();
    target.resize();
    target.easeTo({
      center: [lon, lat],
      zoom: Math.max(target.getZoom(), dimensionLabelsMinZoom(latitude)),
    });
  });
  useEffect(() => {
    if (map === null || centerRequest === null || !visible) return;
    if (centeredRef.current === centerRequest.nonce) return;
    centeredRef.current = centerRequest.nonce;
    centerOn(map, centerRequest.id);
  }, [map, centerRequest, visible]);

  useEffect(() => {
    if (!focusPanelRef.current) return;
    focusPanelRef.current = false;
    openedPanelRef.current?.focus();
  }, [selection]);

  const addResult = (target: MapLibreMap) => {
    const pixelRatio = target.getPixelRatio();
    target.addImage(HATCH_IMAGE, hatchPattern(pixelRatio), { pixelRatio });
    for (const [id, source] of Object.entries(resultSources(mapData, latitude))) {
      target.addSource(id, source);
    }
    for (const layer of resultLayers(latitude)) target.addLayer(layer);

    // Посадка важнее зоны под ней; клик по пустому месту снимает выбор.
    target.on('click', (event) => {
      const [planting] = target.queryRenderedFeatures(event.point, { layers: SELECTABLE_LAYERS });
      const id: unknown = planting?.properties.id;
      if (typeof id === 'string') {
        onSelect({ kind: 'planting', id });
        return;
      }
      const [zone] = target.queryRenderedFeatures(event.point, { layers: [RESULT_LAYER.zones] });
      const index: unknown = zone?.properties.zone_index;
      onSelect(typeof index === 'number' ? { kind: 'zone', index } : null);
    });
    for (const layer of [...SELECTABLE_LAYERS, RESULT_LAYER.zones]) {
      target.on('mouseenter', layer, () => {
        target.getCanvas().style.cursor = 'pointer';
      });
      target.on('mouseleave', layer, () => {
        target.getCanvas().style.cursor = '';
      });
    }
    target.on('zoomend', () => {
      setZoom(target.getZoom());
    });
    setZoom(target.getZoom());
    setMap(target);
  };

  // Выбор из списка — путь для клавиатуры и скринридера: карта подводится к посадке.
  const selectFromList = (id: string | null) => {
    onSelect(id === null ? null : { kind: 'planting', id });
    const feature = mapData.planting.features.find(({ properties }) => properties.id === id);
    const [lon, lat] = feature?.geometry.coordinates ?? [];
    if (map !== null && lon !== undefined && lat !== undefined) map.easeTo({ center: [lon, lat] });
  };

  const changeVisibility = (next: LayerVisibility) => {
    setVisibility(next);
    // Скрытый объект не остаётся выбранным: выделение висело бы над пустым местом.
    const group =
      selectedZone !== undefined
        ? 'zones'
        : selectedPlanting?.properties.plant_type === 'tree'
          ? 'trees'
          : 'shrubs';
    if (selection !== null && !next[group]) onSelect(null);
  };

  const [lon, lat] = selectedPlanting?.geometry.coordinates ?? [];
  const panel =
    selectedPlanting !== undefined ? (
      <PlantingPanel
        ref={openedPanelRef}
        planting={selectedPlanting.properties}
        entry={explanation.get(selectedPlanting.properties.id)}
        coordinates={geographic && lon !== undefined && lat !== undefined ? { lat, lon } : null}
        checks={checks}
        uncovered={data.zones.metadata.uncovered_categories}
        usedSiteBoundary={data.zones.metadata.used_site_boundary}
        onFocusCheck={(index) => {
          setFocused(index === null ? null : { selection, index });
        }}
        onShowZone={(index) => {
          focusPanelRef.current = true;
          setVisibility((previous) => ({ ...previous, zones: true }));
          onSelect({ kind: 'zone', index });
        }}
        onClose={() => {
          closePanel(true);
        }}
      />
    ) : selectedZone !== undefined ? (
      <ZonePanel
        ref={openedPanelRef}
        zone={selectedZone}
        onClose={() => {
          closePanel(true);
        }}
      />
    ) : null;
  const layersPanel = (
    <LayersPanel
      counts={counts}
      visibility={visibility}
      showBasemap={basemap}
      basemapAvailable={basemapAvailable}
      onChange={changeVisibility}
      planting={mapData.planting}
      selectedId={selection?.kind === 'planting' ? selection.id : null}
      onSelect={selectFromList}
      inPopover={narrow}
    />
  );

  return (
    <>
      <div ref={areaRef} className={classes.area}>
        <Suspense fallback={<Skeleton className={classes.fill} radius="xl" />}>
          <MapView
            bounds={bounds}
            padding={{
              top: FIT_GAP_PX,
              bottom: FIT_GAP_PX,
              left: (narrow ? 0 : layersWidth) + FIT_GAP_PX,
              right: ZOOM_CONTROLS_PX,
            }}
            label={resultLabel(data)}
            basemap={basemap}
            basemapVisible={visibility.basemap}
            note={basemap ? undefined : geographic ? OUTSIDE_BASEMAP_NOTE : DRAWING_NOTE}
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
            {!narrow && panel !== null && (
              <div className={classes.topRight}>
                <div ref={panelRef} className={classes.panel}>
                  {panel}
                </div>
              </div>
            )}
          </MapView>
        </Suspense>
      </div>
      {narrow && panel !== null && (
        <div ref={panelRef} className={classes.below}>
          {panel}
        </div>
      )}
    </>
  );
}

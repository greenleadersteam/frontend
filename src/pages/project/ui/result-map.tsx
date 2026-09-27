import { ActionIcon, Popover, Skeleton } from '@mantine/core';
import { useElementSize, useMediaQuery, useWindowEvent } from '@mantine/hooks';
import { IconStack2 } from '@tabler/icons-react';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { type JSX, lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from 'react';

import {
  allowedArea,
  checksAgainstObstacles,
  checksForPlanting,
  checksFromServer,
  CROWN_RADIUS_M,
  dimensionLabelsMinZoom,
  dimensionLines,
  type ExplanationEntry,
  HATCH_IMAGE,
  hatchPattern,
  HEDGE_RULE,
  lawnArea,
  lawnSummary,
  type LocalFrame,
  OBSTACLE_LAYERS,
  obstacleGroup,
  type ObstaclesFeatureCollection,
  pixelsPerMeterAtZoom,
  type PlantingCheck,
  type PlantingFeatureCollection,
  type PlantType,
  plantTypeFilters,
  type PreparedObstacles,
  type PreparedZones,
  type RejectedSitesFeatureCollection,
  RESULT_LAYER,
  RESULT_LAYER_GROUPS,
  RESULT_SOURCE,
  resultCounts,
  type ResultData,
  type ResultLayerGroup,
  resultLayers,
  resultSources,
  SELECTABLE_LAYERS,
  type Species,
  toMapRejected,
} from '@/entities/project';
import { Icon } from '@/shared/ui';

import { LawnPanel } from './lawn-panel';
import { LayersPanel, type LayerVisibility } from './layers-panel';
import { ObstaclePanel } from './obstacle-panel';
import { PlantingPanel } from './planting-panel';
import { RejectedPanel } from './rejected-panel';
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
// Линию сети толщиной 1,5px трудно попасть курсором: щелчок ищет объект в квадрате вокруг.
const OBSTACLE_HIT_PX = 4;

export type Selection =
  | { kind: 'planting'; id: string }
  | { kind: 'zone'; index: number }
  | { kind: 'obstacle'; index: number }
  | { kind: 'rejected'; index: number }
  | { kind: 'lawn' }
  | null;

// Объекты подосновы: в координатах карты для слоёв и подготовленные для проверок.
export type MapObstacles = { map: ObstaclesFeatureCollection; prepared: PreparedObstacles };

// Просьба подвести камеру к посадке (из ведомости). nonce различает повторы для той же посадки.
export type CenterRequest = {
  target: { kind: 'planting'; id: string } | { kind: 'rejected'; index: number };
  nonce: number;
};

type ResultMapProps = {
  // Данные бэкенда: по ним считаются проверки.
  data: ResultData;
  // Те же данные в координатах карты.
  mapData: ResultData;
  // Охват в координатах карты: [запад, юг, восток, север].
  bounds: [number, number, number, number];
  frame: LocalFrame;
  prepared: PreparedZones;
  // null — сервер не отдаёт /obstacles: проверки считаются по зонам запрета.
  obstacles: MapObstacles | null;
  explanation: ReadonlyMap<string, ExplanationEntry>;
  // Справочник пород по id (возможность species); пуст — пород нет.
  species: ReadonlyMap<string, Species>;
  // Отклонённые места (возможность rejected); null — сервер их не отдаёт.
  rejected: RejectedSitesFeatureCollection | null;
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
// координаты карты условные. Есть объекты подосновы — расстояние до них прямое, иначе — через
// зоны запрета.
function plantingChecks(
  feature: PlantingFeatureCollection['features'][number] | undefined,
  entry: ExplanationEntry | undefined,
  frame: LocalFrame,
  prepared: PreparedZones,
  obstacles: MapObstacles | null,
): PlantingCheck[] {
  if (feature === undefined) return [];
  const point = frame.toLocal(feature.geometry.coordinates);
  const { plant_type: plantType } = feature.properties;
  return obstacles === null
    ? checksForPlanting(point, plantType, prepared)
    : checksAgainstObstacles(point, plantType, entry?.checks, obstacles.prepared);
}

export function ResultMap({
  data,
  mapData,
  bounds,
  frame,
  prepared,
  obstacles,
  explanation,
  species,
  rejected,
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
    allowed: true,
    lawn: true,
    siteBoundary: true,
    utilities: true,
    buildings: true,
    edges: true,
    // Отклонённых мест на крупном участке тысячи: слой включают, когда хотят понять, почему
    // в пустом месте ничего нет.
    rejected: false,
    basemap: true,
  });
  // Для какого типа посадки показаны «можно» и зоны запрета.
  const [plantType, setPlantType] = useState<PlantType>('tree');
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
  const obstacleRef = useRef<number | null>(null);
  const rejectedRef = useRef<number | null>(null);

  const selectedPlanting =
    selection?.kind === 'planting'
      ? data.planting.features.find(({ properties }) => properties.id === selection.id)
      : undefined;
  const selectedZone = selection?.kind === 'zone' ? prepared.zones[selection.index] : undefined;
  const selectedObstacle =
    selection?.kind === 'obstacle' ? obstacles?.prepared.obstacles[selection.index] : undefined;
  const selectedEntry =
    selectedPlanting === undefined ? undefined : explanation.get(selectedPlanting.properties.id);
  const selectedRejected =
    selection?.kind === 'rejected' ? rejected?.features[selection.index] : undefined;
  const rejectedChecks =
    selectedRejected === undefined
      ? null
      : checksFromServer(
          frame.toLocal(selectedRejected.geometry.coordinates),
          selectedRejected.properties.plant_type,
          selectedRejected.properties.failed_checks,
          obstacles?.prepared ?? null,
        );
  const checks =
    rejectedChecks ?? plantingChecks(selectedPlanting, selectedEntry, frame, prepared, obstacles);
  // Тип посадки выбранной точки — для отступа подписей размеров от кроны.
  const selectedPlantType =
    selectedPlanting?.properties.plant_type ?? selectedRejected?.properties.plant_type ?? null;
  const speciesId = selectedPlanting?.properties.species_id;
  const selectedSpecies = speciesId == null ? null : (species.get(speciesId) ?? null);
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
    const shown: Record<string, boolean> = visibility;
    for (const [group, layers] of Object.entries(RESULT_LAYER_GROUPS)) {
      for (const layer of layers) {
        map.setLayoutProperty(layer, 'visibility', shown[group] === true ? 'visible' : 'none');
      }
    }
  }, [map, visibility]);

  useEffect(() => {
    if (map === null) return;
    for (const [layer, filter] of Object.entries(plantTypeFilters(plantType))) {
      map.setFilter(layer, filter);
    }
  }, [map, plantType]);

  // Выделение — feature-state по id посадки и номеру зоны: источники не пересоздаются.
  useEffect(() => {
    if (map === null) return;
    const plantingId = selection?.kind === 'planting' ? selection.id : null;
    const zoneIndex = selection?.kind === 'zone' ? selection.index : null;
    const obstacleIndex = selection?.kind === 'obstacle' ? selection.index : null;
    const rejectedIndex = selection?.kind === 'rejected' ? selection.index : null;
    if (rejectedRef.current !== null) {
      map.setFeatureState(
        { source: RESULT_SOURCE.rejectedPoints, id: rejectedRef.current },
        { selected: false },
      );
    }
    if (rejectedIndex !== null) {
      map.setFeatureState(
        { source: RESULT_SOURCE.rejectedPoints, id: rejectedIndex },
        { selected: true },
      );
    }
    rejectedRef.current = rejectedIndex;
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
    if (obstacleRef.current !== null) {
      map.setFeatureState(
        { source: RESULT_SOURCE.obstacles, id: obstacleRef.current },
        { selected: false },
      );
    }
    if (plantingId !== null) {
      map.setFeatureState({ source: RESULT_SOURCE.planting, id: plantingId }, { selected: true });
    }
    if (zoneIndex !== null) {
      map.setFeatureState({ source: RESULT_SOURCE.zones, id: zoneIndex }, { selected: true });
    }
    if (obstacleIndex !== null) {
      map.setFeatureState(
        { source: RESULT_SOURCE.obstacles, id: obstacleIndex },
        { selected: true },
      );
    }
    plantingRef.current = plantingId;
    zoneRef.current = zoneIndex;
    obstacleRef.current = obstacleIndex;
  }, [map, selection]);

  // Размерные линии выбранной посадки; засечки пересчитываются с масштабом. Проверки
  // посчитаны при рендере, React Compiler не пересчитывает их без смены выбора.
  useEffect(() => {
    const lines = dimensionLines(checks, frame, {
      focused: focusedCheck,
      metersPerPixel: 1 / pixelsPerMeterAtZoom(zoom, latitude),
      // Без выбранной точки проверок нет, и радиус не нужен.
      crownRadiusM: selectedPlantType === null ? 0 : CROWN_RADIUS_M[selectedPlantType],
    });
    void map?.getSource<GeoJSONSource>(RESULT_SOURCE.dimensions)?.setData(lines);
  }, [map, checks, frame, focusedCheck, zoom, latitude, selectedPlantType]);

  // Переход из ведомости: камера подводится к посадке, когда план уже показан. Вид меняется
  // через URL позже, чем выбор, а ResizeObserver MapLibre сообщит новый размер ещё позже:
  // без resize() центр считался бы по скрытому контейнеру. Масштаб — не мельче того, где
  // видны подписи размерных линий. При prefers-reduced-motion MapLibre переходит без анимации.
  const centeredRef = useRef<number | null>(null);
  const centerOn = useEffectEvent((target: MapLibreMap, request: CenterRequest['target']) => {
    // Посадку или место на выключенном слое не выбрать: выделение висело бы над пустым местом.
    let point: readonly number[];
    if (request.kind === 'planting') {
      const feature = mapData.planting.features.find(
        ({ properties }) => properties.id === request.id,
      );
      if (feature === undefined) return;
      point = feature.geometry.coordinates;
      const group = feature.properties.plant_type === 'tree' ? 'trees' : 'shrubs';
      setVisibility((previous) => ({ ...previous, [group]: true }));
    } else {
      const site = rejected?.features[request.index];
      if (site === undefined) return;
      point = frame.toMap(frame.toLocal(site.geometry.coordinates));
      setVisibility((previous) => ({ ...previous, rejected: true }));
    }
    const [lon, lat] = point;
    if (lon === undefined || lat === undefined) return;
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
    centerOn(map, centerRequest.target);
  }, [map, centerRequest, visible]);

  useEffect(() => {
    if (!focusPanelRef.current) return;
    focusPanelRef.current = false;
    openedPanelRef.current?.focus();
  }, [selection]);

  const addResult = (target: MapLibreMap) => {
    const pixelRatio = target.getPixelRatio();
    target.addImage(HATCH_IMAGE, hatchPattern(pixelRatio), { pixelRatio });
    for (const [id, source] of Object.entries(
      resultSources(
        mapData,
        obstacles?.map ?? null,
        rejected === null ? null : toMapRejected(rejected, frame),
        latitude,
      ),
    )) {
      target.addSource(id, source);
    }
    for (const layer of resultLayers(latitude)) target.addLayer(layer);

    // Приоритет щелчка: посадка (и полоса изгороди) > отклонённое место > объект > зона
    // запрета > газон; щелчок по пустому месту снимает выбор.
    target.on('click', (event) => {
      const [planting] = target.queryRenderedFeatures(event.point, { layers: SELECTABLE_LAYERS });
      const id: unknown = planting?.properties.id;
      if (typeof id === 'string') {
        onSelect({ kind: 'planting', id });
        return;
      }
      // Полоса изгороди — выбор ближайшей её посадки.
      if (target.queryRenderedFeatures(event.point, { layers: [RESULT_LAYER.hedges] }).length > 0) {
        const hedge = nearestHedgePlanting(mapData.planting, [event.lngLat.lng, event.lngLat.lat]);
        if (hedge !== null) {
          onSelect({ kind: 'planting', id: hedge });
          return;
        }
      }
      const [site] = target.queryRenderedFeatures(event.point, {
        layers: [RESULT_LAYER.rejectedHit],
      });
      const rejectedIndex: unknown = site?.properties.rejected_index;
      if (typeof rejectedIndex === 'number') {
        onSelect({ kind: 'rejected', index: rejectedIndex });
        return;
      }
      const { x, y } = event.point;
      const [obstacle] = target.queryRenderedFeatures(
        [
          [x - OBSTACLE_HIT_PX, y - OBSTACLE_HIT_PX],
          [x + OBSTACLE_HIT_PX, y + OBSTACLE_HIT_PX],
        ],
        { layers: OBSTACLE_LAYERS },
      );
      const obstacleIndex: unknown = obstacle?.properties.obstacle_index;
      if (typeof obstacleIndex === 'number') {
        onSelect({ kind: 'obstacle', index: obstacleIndex });
        return;
      }
      const [zone] = target.queryRenderedFeatures(event.point, { layers: [RESULT_LAYER.zones] });
      const index: unknown = zone?.properties.zone_index;
      if (typeof index === 'number') {
        onSelect({ kind: 'zone', index });
        return;
      }
      const onLawn =
        target.queryRenderedFeatures(event.point, { layers: [RESULT_LAYER.lawn] }).length > 0;
      onSelect(onLawn ? { kind: 'lawn' } : null);
    });
    for (const layer of [
      ...SELECTABLE_LAYERS,
      RESULT_LAYER.hedges,
      RESULT_LAYER.rejectedHit,
      ...OBSTACLE_LAYERS,
      RESULT_LAYER.zones,
      RESULT_LAYER.lawn,
    ]) {
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

  const selectedGroup: ResultLayerGroup | null =
    selection?.kind === 'lawn'
      ? 'lawn'
      : selectedRejected !== undefined
        ? 'rejected'
        : selectedZone !== undefined
          ? 'zones'
          : selectedObstacle !== undefined
            ? obstacleGroup(selectedObstacle.properties.category)
            : selectedPlanting === undefined
              ? null
              : selectedPlanting.properties.plant_type === 'tree'
                ? 'trees'
                : 'shrubs';

  const changeVisibility = (next: LayerVisibility) => {
    setVisibility(next);
    // Скрытый объект не остаётся выбранным: выделение висело бы над пустым местом.
    if (selectedGroup !== null && !next[selectedGroup]) onSelect(null);
  };

  const changePlantType = (next: PlantType) => {
    setPlantType(next);
    // Зона другого типа посадки скрывается фильтром — её выбор снимается.
    if (selectedZone !== undefined && selectedZone.properties.plant_type !== next) onSelect(null);
  };

  const summary =
    selection?.kind === 'lawn'
      ? lawnSummary(
          prepared,
          data.planting.features.map(({ geometry, properties }) => ({
            point: frame.toLocal(geometry.coordinates),
            plantType: properties.plant_type,
          })),
          data.zones.metadata.used_site_boundary,
        )
      : null;
  const [lon, lat] = selectedPlanting?.geometry.coordinates ?? [];
  const panel =
    selectedPlanting !== undefined ? (
      <PlantingPanel
        ref={openedPanelRef}
        planting={selectedPlanting.properties}
        entry={selectedEntry}
        species={selectedSpecies}
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
          // Зона посадки — её типа: переключатель показывает зоны этого типа.
          setPlantType(selectedPlanting.properties.plant_type);
          onSelect({ kind: 'zone', index });
        }}
        onShowObstacle={({ index, properties }) => {
          const group = obstacleGroup(properties.category);
          focusPanelRef.current = true;
          if (group !== null) setVisibility((previous) => ({ ...previous, [group]: true }));
          onSelect({ kind: 'obstacle', index });
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
    ) : selectedRejected !== undefined && rejectedChecks !== null ? (
      <RejectedPanel
        ref={openedPanelRef}
        site={selectedRejected.properties}
        ruleName={
          [...explanation.values()].find(
            ({ rule_id: ruleId }) => ruleId === selectedRejected.properties.rule_id,
          )?.rule_name_ru ?? null
        }
        checks={rejectedChecks}
        onFocusCheck={(index) => {
          setFocused(index === null ? null : { selection, index });
        }}
        onShowObstacle={({ index, properties }) => {
          const group = obstacleGroup(properties.category);
          focusPanelRef.current = true;
          if (group !== null) setVisibility((previous) => ({ ...previous, [group]: true }));
          onSelect({ kind: 'obstacle', index });
        }}
        onClose={() => {
          closePanel(true);
        }}
      />
    ) : selection?.kind === 'lawn' && summary !== null ? (
      <LawnPanel
        ref={openedPanelRef}
        summary={summary}
        onClose={() => {
          closePanel(true);
        }}
      />
    ) : selectedObstacle !== undefined && obstacles !== null ? (
      <ObstaclePanel
        ref={openedPanelRef}
        obstacle={selectedObstacle}
        norms={obstacles.prepared}
        onClose={() => {
          closePanel(true);
        }}
      />
    ) : null;
  const layersPanel = (
    <LayersPanel
      counts={{ ...counts, zones: counts.zonesByType[plantType] }}
      plantType={plantType}
      onPlantTypeChange={changePlantType}
      allowedArea={allowedArea(prepared, plantType)}
      obstacles={obstacles?.map ?? null}
      rejectedCount={rejected?.features.length ?? null}
      lawnArea={lawnArea(prepared)}
      showSiteBoundary={
        data.zones.metadata.used_site_boundary &&
        data.zones.features.some(({ properties }) => properties.zone_type === 'site_boundary')
      }
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

// Ближайшая к точке щелчка посадка живой изгороди, в координатах карты: долгота сжата
// косинусом широты, чтобы градусы по осям весили одинаково.
function nearestHedgePlanting(
  planting: PlantingFeatureCollection,
  [lon, lat]: [number, number],
): string | null {
  const scale = Math.cos((lat * Math.PI) / 180);
  let best: { id: string; distance: number } | null = null;
  for (const { geometry, properties } of planting.features) {
    if (properties.rule_id !== HEDGE_RULE) continue;
    const [x = lon, y = lat] = geometry.coordinates;
    const distance = Math.hypot((x - lon) * scale, y - lat);
    if (best === null || distance < best.distance) best = { id: properties.id, distance };
  }
  return best?.id ?? null;
}

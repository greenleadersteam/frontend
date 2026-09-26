import 'maplibre-gl/dist/maplibre-gl.css';

import { ActionIcon, Text } from '@mantine/core';
import { IconFocusCentered, IconMinus, IconPlus } from '@tabler/icons-react';
import {
  AttributionControl,
  Map as MapLibreMap,
  type PaddingOptions,
  ScaleControl,
  setWorkerUrl,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { type JSX, type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react';

import { BASEMAP_BOUNDS, getRuntimeConfig, MAP_MAX_ZOOM, MAP_MIN_ZOOM } from '@/shared/config';
import { Icon } from '@/shared/ui';

import { BASEMAP_SOURCE, basemapStyle } from './basemap-style';
import classes from './map-view.module.css';
import { openBasemapArchive } from './pmtiles-protocol';

// Воркер MapLibre ищет себя рядом с основным модулем через import.meta.url, а после сборки
// Vite основной модуль лежит в другом чанке. Адрес собранного воркера даёт ?worker&url.
setWorkerUrl(workerUrl);

// При вписывании участок не приближается сильнее: дальше подложка уже без деталей.
const FIT_MAX_ZOOM = 19;

type MapBounds = [west: number, south: number, east: number, north: number];

type MapViewProps = {
  // Охват, в который карта вписывается при открытии и по «Показать весь участок».
  bounds: MapBounds;
  // Поля вписывания: под панели поверх карты.
  padding: PaddingOptions;
  // Краткое содержание карты для скринридера — подпись canvas.
  label: string;
  basemapVisible: boolean;
  // Стиль загружен: потребитель добавляет свои источники и слои.
  onReady: (map: MapLibreMap) => void;
  onBasemapResolved: (available: boolean) => void;
  // WebGL недоступен или контекст потерян: потребитель показывает запасной вид.
  onUnavailable: () => void;
  // Панели поверх карты.
  children?: ReactNode;
};

type Basemap = 'checking' | 'available' | 'missing';

export function MapView({
  bounds,
  padding,
  label,
  basemapVisible,
  onReady,
  onBasemapResolved,
  onUnavailable,
  children,
}: MapViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [basemap, setBasemap] = useState<Basemap>('checking');

  const fit = (target: MapLibreMap, animate: boolean) => {
    target.fitBounds(bounds, { padding, maxZoom: FIT_MAX_ZOOM, animate });
  };

  // Поля зависят от размеров панелей, измеренных уже после монтирования: вписывание
  // повторяется по load с актуальными значениями.
  const fitOnLoad = useEffectEvent((target: MapLibreMap) => {
    fit(target, false);
  });

  const create = useEffectEvent((container: HTMLElement, archiveUrl: string | null) => {
    setBasemap(archiveUrl === null ? 'missing' : 'available');
    onBasemapResolved(archiveUrl !== null);

    let created: MapLibreMap;
    try {
      created = new MapLibreMap({
        container,
        style: basemapStyle(archiveUrl),
        minZoom: MAP_MIN_ZOOM,
        maxZoom: MAP_MAX_ZOOM,
        maxBounds: BASEMAP_BOUNDS,
        bounds,
        fitBoundsOptions: { padding, maxZoom: FIT_MAX_ZOOM },
        // План посадок читается с севера вверх: поворот и наклон не нужны.
        dragRotate: false,
        pitchWithRotate: false,
        maxPitch: 0,
        attributionControl: false,
        locale: {
          'Map.Title': label,
          'ScaleControl.Meters': 'м',
          'ScaleControl.Kilometers': 'км',
        },
      });
    } catch {
      // GPUInitializationError: у рабочего места нет WebGL.
      onUnavailable();
      return null;
    }
    created.touchZoomRotate.disableRotation();
    created.keyboard.disableRotation();
    created.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
    if (archiveUrl !== null) {
      created.addControl(
        new AttributionControl({
          compact: false,
          customAttribution: '© участники OpenStreetMap, Protomaps',
        }),
        'bottom-left',
      );
    }
    created.on('webglcontextlost', onUnavailable);
    created.on('load', () => {
      onReady(created);
      fitOnLoad(created);
      setMap(created);
    });
    return created;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    let created: MapLibreMap | null = null;
    let cancelled = false;
    void openBasemapArchive(getRuntimeConfig().basemapUrl).then((archiveUrl) => {
      if (!cancelled) created = create(container, archiveUrl);
    });
    return () => {
      cancelled = true;
      created?.remove();
      setMap(null);
    };
  }, []);

  useEffect(() => {
    if (map === null) return;
    for (const layer of map.getStyle().layers) {
      if ('source' in layer && layer.source === BASEMAP_SOURCE) {
        map.setLayoutProperty(layer.id, 'visibility', basemapVisible ? 'visible' : 'none');
      }
    }
  }, [map, basemapVisible]);

  useEffect(() => {
    map?.getCanvas().setAttribute('aria-label', label);
  }, [map, label]);

  return (
    <div className={classes.root}>
      <div ref={containerRef} className={classes.map} />
      {children}
      {basemap === 'missing' && (
        <Text size="xs" className={classes.basemapMissing}>
          Подложка не загружена
        </Text>
      )}
      <ActionIcon.Group orientation="vertical" className={classes.zoom}>
        <ActionIcon
          variant="default"
          size="lg"
          aria-label="Приблизить"
          disabled={map === null}
          onClick={() => map?.zoomIn()}
        >
          <Icon icon={IconPlus} />
        </ActionIcon>
        <ActionIcon
          variant="default"
          size="lg"
          aria-label="Отдалить"
          disabled={map === null}
          onClick={() => map?.zoomOut()}
        >
          <Icon icon={IconMinus} />
        </ActionIcon>
        <ActionIcon
          variant="default"
          size="lg"
          aria-label="Показать весь участок"
          disabled={map === null}
          onClick={() => {
            if (map !== null) fit(map, true);
          }}
        >
          <Icon icon={IconFocusCentered} />
        </ActionIcon>
      </ActionIcon.Group>
    </div>
  );
}

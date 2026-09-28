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

import {
  BASEMAP_BOUNDS,
  getRuntimeConfig,
  type ImageryConfig,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
} from '@/shared/config';
import { Icon } from '@/shared/ui';

import { basemapStyle, loadLabelFont } from './basemap-style';
import { BASEMAP_SOURCE, type BasemapKind, IMAGERY_SOURCES } from './basemaps';
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
  // false — карта без подложки и без охвата Москвы: координаты не привязаны к городу.
  basemap: boolean;
  basemapVisible: boolean;
  // Какую подложку показать; «Снимок» — только если передан imagery.
  basemapKind?: BasemapKind;
  // Космоснимок из конфига контура; без него карта строится только со «Схемой».
  imagery?: ImageryConfig | null;
  maxZoom?: number;
  // Тихая подпись в углу вместо атрибуции подложки; может нести тихую кнопку.
  note?: ReactNode;
  // Стиль загружен: потребитель добавляет свои источники и слои.
  onReady: (map: MapLibreMap) => void;
  onBasemapResolved: (available: boolean) => void;
  // WebGL недоступен или контекст потерян: потребитель показывает запасной вид.
  onUnavailable: () => void;
  // Панели поверх карты.
  children?: ReactNode;
  // Карта для снимка (отчёт для печати): буфер кадра сохраняется, чтобы холст можно было
  // прочитать в изображение; без жестов и кнопок масштаба.
  snapshot?: boolean;
};

type Basemap = 'checking' | 'available' | 'missing';

export function MapView({
  bounds,
  padding,
  label,
  basemap: withBasemap,
  basemapVisible,
  basemapKind = 'scheme',
  imagery = null,
  maxZoom = MAP_MAX_ZOOM,
  note,
  onReady,
  onBasemapResolved,
  onUnavailable,
  children,
  snapshot = false,
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
        style: basemapStyle(archiveUrl, imagery),
        minZoom: MAP_MIN_ZOOM,
        maxZoom,
        ...(withBasemap && { maxBounds: BASEMAP_BOUNDS }),
        bounds,
        fitBoundsOptions: { padding, maxZoom: FIT_MAX_ZOOM },
        // План посадок читается с севера вверх: поворот и наклон не нужны.
        dragRotate: false,
        pitchWithRotate: false,
        maxPitch: 0,
        attributionControl: false,
        ...(snapshot && {
          interactive: false,
          canvasContextAttributes: { preserveDrawingBuffer: true },
        }),
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
    // Атрибуция — у источников подложки: MapLibre показывает её, пока слой источника виден.
    if (archiveUrl !== null || imagery !== null) {
      created.addControl(new AttributionControl({ compact: false }), 'bottom-left');
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
    void (withBasemap ? openBasemapArchive(getRuntimeConfig().basemapUrl) : Promise.resolve(null))
      .then(async (archiveUrl) => {
        // Не загрузился шрифт — карта всё равно нужна, подписи возьмут запасной.
        await loadLabelFont().catch(() => undefined);
        return archiveUrl;
      })
      .then((archiveUrl) => {
        if (!cancelled) created = create(container, archiveUrl);
      });
    return () => {
      cancelled = true;
      created?.remove();
      setMap(null);
    };
  }, [withBasemap]);

  useEffect(() => {
    if (map === null) return;
    const shown: Record<string, boolean> = {
      [BASEMAP_SOURCE]: basemapVisible && basemapKind === 'scheme',
      ...Object.fromEntries(
        IMAGERY_SOURCES.map((source) => [source, basemapVisible && basemapKind === 'imagery']),
      ),
    };
    for (const layer of map.getStyle().layers) {
      const visible = 'source' in layer ? shown[layer.source] : undefined;
      if (visible !== undefined) {
        map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
      }
    }
  }, [map, basemapVisible, basemapKind]);

  useEffect(() => {
    map?.getCanvas().setAttribute('aria-label', label);
  }, [map, label]);

  return (
    <div className={classes.root}>
      <div ref={containerRef} className={classes.map} />
      {children}
      {note !== undefined ? (
        <Text size="xs" component="div" className={classes.note}>
          {note}
        </Text>
      ) : (
        basemap === 'missing' &&
        basemapKind === 'scheme' && (
          <Text size="xs" className={classes.note}>
            Подложка не загружена
          </Text>
        )
      )}
      {!snapshot && (
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
      )}
    </div>
  );
}

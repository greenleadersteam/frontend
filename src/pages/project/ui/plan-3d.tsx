import { ActionIcon, Button, Group, SegmentedControl, Stack, Text, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconInfoCircle } from '@tabler/icons-react';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { type JSX, useEffect, useId, useRef, useState } from 'react';

import type { Species } from '@/entities/project';
import { saveFile } from '@/shared/lib/save-file';
import { BASEMAP_SOURCE } from '@/shared/map';
import { plan3dColors } from '@/shared/theme';
import { Icon } from '@/shared/ui';

import { type Shot, shotsArchive, STAGES, VIEWS } from '../lib/plan-3d-archive';
import { type View, viewCamera } from '../lib/plan-3d-camera';
import { plantingScene, type ScenePlanting } from '../lib/plan-3d-geometry';
import { capturePlate } from '../lib/plan-3d-plate';
import { type Stage, stageVisibility } from '../lib/plan-3d-stage';
import classes from './plan-3d.module.css';

const SOURCE = 'plan-3d';
const LAYERS = {
  trunk: 'plan-3d-trunks',
  crown: 'plan-3d-crowns',
  shrub: 'plan-3d-shrubs',
  buildings: 'plan-3d-buildings',
} as const;
const PLANTING_LAYERS = [LAYERS.trunk, LAYERS.crown, LAYERS.shrub];
// Пешеходный ракурс — 75°, выше умолчания MapLibre (60°).
const MAX_PITCH = 85;
const FIT_PADDING = 48;
const SAVE_FAILED = 'Визуализации не сохранены. Повторите скачивание.';
const ABOUT =
  'Схематичная 3D-визуализация по плану посадок. Размеры крон — условные или по справочнику пород.';
const CONVENTIONAL_NOTE = 'У части посадок размеры условные: нет данных о породе.';

const VIEW_LABELS: Record<View, string> = {
  overview: 'Обзор',
  along: 'Вдоль участка',
  pedestrian: 'С уровня пешехода',
};
const STAGE_OPTIONS = [
  { value: 'before', label: 'До' },
  { value: 'after', label: 'После' },
];

type Plan3dProps = {
  map: MapLibreMap;
  // Посадки выбранной версии плана с правками.
  planting: ScenePlanting;
  species: ReadonlyMap<string, Species>;
  // Для подписи на снимках: название проекта и версия плана.
  title: string;
  version: string;
  fileName: string;
  // Посадки плана в 2D прячет карта: видимостью её слоёв управляет один источник.
  onStage: (stage: Stage) => void;
  // Съёмка идёт: экран не даёт выйти из 3D и сменить вид, пока кадры не сняты.
  onBusy: (busy: boolean) => void;
};

function moveCamera(map: MapLibreMap, view: View, points: readonly [number, number][]) {
  const camera = viewCamera(view, points);
  if (camera.kind === 'point') {
    map.jumpTo(camera);
    return;
  }
  const fitted = map.cameraForBounds(camera.bounds, {
    bearing: camera.bearing,
    padding: FIT_PADDING,
  });
  map.jumpTo({ ...fitted, bearing: camera.bearing, pitch: camera.pitch });
}

// Жесты карты во время съёмки сдвинули бы кадр между ракурсом и снимком.
const HANDLERS = ['dragPan', 'scrollZoom', 'keyboard', 'dragRotate', 'touchZoomRotate'] as const;
const setGestures = (map: MapLibreMap, enabled: boolean) => {
  for (const handler of HANDLERS) {
    if (enabled) map[handler].enable();
    else map[handler].disable();
  }
};

const idle = (map: MapLibreMap) =>
  new Promise<void>((resolve) => {
    map.once('idle', () => {
      resolve();
    });
    map.triggerRepaint();
  });

// Схематичная 3D-сцена на карте плана. Размонтирование возвращает карту как было: камера,
// наклон 0, предел наклона.
export function Plan3d({
  map,
  planting,
  species,
  title,
  version,
  fileName,
  onStage,
  onBusy,
}: Plan3dProps): JSX.Element {
  const [stage, setStage] = useState<Stage>('after');
  const [view, setView] = useState<View>('overview');
  const [saving, setSaving] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  // Свёрнутая панель — одна кнопка: сцена видна целиком.
  const [collapsed, setCollapsed] = useState(false);
  // Подсказка «О визуализации» — и по фокусу с клавиатуры, не только при наведении мыши.
  const [aboutShown, setAboutShown] = useState(false);
  const aboutId = useId();
  // Режим выключен посреди съёмки (уход со страницы): кадры больше не снимаются.
  const mounted = useRef(true);
  const scene = plantingScene(planting, species);
  const points = planting.features.map(({ geometry }): [number, number] => {
    const [lon = 0, lat = 0] = geometry.coordinates;
    return [lon, lat];
  });

  // Слои сцены — один раз на подключение; данные версии — ниже, в своём эффекте.
  useEffect(() => {
    mounted.current = true;
    const camera = {
      center: map.getCenter(),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      maxPitch: map.getMaxPitch(),
    };
    map.setMaxPitch(MAX_PITCH);
    map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // Без высоты в плитках выражение даёт 0: такие здания остаются плоскими.
    map.addLayer({
      id: LAYERS.buildings,
      type: 'fill-extrusion',
      source: BASEMAP_SOURCE,
      'source-layer': 'buildings',
      paint: {
        'fill-extrusion-color': plan3dColors.buildings,
        'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
        'fill-extrusion-height': ['coalesce', ['get', 'height'], 0],
        'fill-extrusion-opacity': 0.7,
      },
    });
    const extrusion = (id: string, part: string, color: string) => {
      map.addLayer({
        id,
        type: 'fill-extrusion',
        source: SOURCE,
        filter: ['==', ['get', 'part'], part],
        paint: {
          'fill-extrusion-color': color,
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-opacity': 0.95,
        },
      });
    };
    extrusion(LAYERS.trunk, 'trunk', plan3dColors.trunk);
    extrusion(LAYERS.crown, 'crown', plan3dColors.crown);
    extrusion(LAYERS.shrub, 'shrub', plan3dColors.shrub);
    return () => {
      mounted.current = false;
      for (const layer of Object.values(LAYERS)) {
        if (map.getLayer(layer) !== undefined) map.removeLayer(layer);
      }
      if (map.getSource(SOURCE) !== undefined) map.removeSource(SOURCE);
      setGestures(map, true);
      map.jumpTo({ center: camera.center, zoom: camera.zoom, bearing: camera.bearing, pitch: 0 });
      map.setMaxPitch(camera.maxPitch);
    };
  }, [map]);

  useEffect(() => {
    const source: GeoJSONSource | undefined = map.getSource(SOURCE);
    void source?.setData(scene.extrusions);
  }, [map, scene.extrusions]);

  const showStage = (next: Stage) => {
    for (const [layer, visible] of stageVisibility(next, PLANTING_LAYERS)) {
      if (map.getLayer(layer) !== undefined) {
        map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none');
      }
    }
    onStage(next);
  };

  const showView = (next: View) => {
    if (points.length > 0) moveCamera(map, next, points);
  };

  // Первый ракурс — обзор, как только слои на месте.
  useEffect(() => {
    if (points.length > 0) moveCamera(map, 'overview', points);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при подключении: дальше ракурс выбирает пользователь
  }, [map]);

  // Через функцию, а не прямым чтением: после await ref мог смениться, а сужение типа этого не видит.
  const stopped = () => !mounted.current;

  const download = async () => {
    setSaving(true);
    onBusy(true);
    setGestures(map, false);
    setAnnouncement('Снимаются визуализации');
    const shots: Shot[] = [];
    try {
      for (const shotView of VIEWS) {
        showView(shotView);
        for (const shotStage of STAGES) {
          showStage(shotStage);
          await idle(map);
          if (stopped()) return;
          const png = await capturePlate(map, [
            title,
            version,
            'Схематичная визуализация по плану посадок',
            attribution(map),
          ]);
          if (stopped()) return;
          shots.push({ view: shotView, stage: shotStage, png });
        }
      }
      saveFile(new Blob([shotsArchive(shots)], { type: 'application/zip' }), fileName);
      setAnnouncement('Архив визуализаций сохранён');
    } catch {
      notifications.show({ color: 'clay', message: SAVE_FAILED });
      setAnnouncement(SAVE_FAILED);
    } finally {
      if (mounted.current) {
        setGestures(map, true);
        showView(view);
        showStage(stage);
        setSaving(false);
        onBusy(false);
      }
    }
  };

  if (collapsed) {
    return (
      <div className={classes.panel}>
        <Button
          variant="default"
          size="compact-sm"
          onClick={() => {
            setCollapsed(false);
          }}
        >
          3D-настройки
        </Button>
      </div>
    );
  }

  return (
    <Stack gap="xs" className={classes.panel}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Group gap={4} wrap="nowrap">
          <Text size="sm" fw={600}>
            3D
          </Text>
          <Tooltip
            label={
              <span id={aboutId}>
                {ABOUT + (scene.conventional ? ` ${CONVENTIONAL_NOTE}` : '')}
              </span>
            }
            multiline
            opened={aboutShown}
            classNames={{ tooltip: classes.tooltip }}
          >
            <ActionIcon
              variant="subtle"
              size="sm"
              aria-label="О визуализации"
              aria-describedby={aboutShown ? aboutId : undefined}
              onFocus={() => {
                setAboutShown(true);
              }}
              onBlur={() => {
                setAboutShown(false);
              }}
              onMouseEnter={() => {
                setAboutShown(true);
              }}
              onMouseLeave={() => {
                setAboutShown(false);
              }}
            >
              <Icon icon={IconInfoCircle} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <Button
          variant="subtle"
          size="compact-xs"
          onClick={() => {
            setCollapsed(true);
          }}
        >
          Свернуть
        </Button>
      </Group>
      <SegmentedControl
        size="xs"
        data={STAGE_OPTIONS}
        value={stage}
        aria-label="До или после озеленения"
        // Пока снимаются ракурсы, камеру и стадию ведёт съёмка.
        disabled={saving}
        onChange={(value) => {
          const next: Stage = value === 'before' ? 'before' : 'after';
          setStage(next);
          showStage(next);
        }}
      />
      <Group gap="xs">
        {VIEWS.map((item) => (
          <Button
            key={item}
            size="compact-sm"
            variant={item === view ? 'light' : 'subtle'}
            aria-pressed={item === view}
            disabled={saving}
            onClick={() => {
              setView(item);
              showView(item);
            }}
          >
            {VIEW_LABELS[item]}
          </Button>
        ))}
      </Group>
      <Group>
        <Button
          variant="default"
          size="compact-sm"
          loading={saving}
          onClick={() => void download()}
        >
          Скачать визуализации
        </Button>
      </Group>
      <Text size="xs" aria-live="polite" className={classes.announcement}>
        {announcement}
      </Text>
    </Stack>
  );
}

// Атрибуция подложки — та же строка, что в углу карты.
const attribution = (map: MapLibreMap): string =>
  map.getContainer().querySelector('.maplibregl-ctrl-attrib-inner')?.textContent ?? '';

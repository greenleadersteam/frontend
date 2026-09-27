import {
  ActionIcon,
  Button,
  Drawer,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Text,
  VisuallyHidden,
} from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconArrowBackUp, IconArrowForwardUp } from '@tabler/icons-react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { type JSX, useEffect, useRef, useState } from 'react';

import { georeferenceActions, placementOf, selectGeoreference } from '@/entities/georeference';
import { getRuntimeConfig, PRODUCT_NAME } from '@/shared/config';
import { useAppDispatch, useAppSelector } from '@/shared/lib/store';
import {
  type BasemapKind,
  basemapOptions,
  IMAGERY_MAX_ZOOM,
  MapView,
  watchBasemap,
} from '@/shared/map';
import { PANELS_BREAKPOINT } from '@/shared/theme';
import { Icon } from '@/shared/ui';

import { BindingPanel } from './binding-panel';
import { DEFAULT_FILL_OPACITY } from './contour-layers';
import { ContourPanel, GEOJSON_ACCEPT } from './contour-panel';
import classes from './georeference-page.module.css';
import { StatusBar } from './status-bar';
import { useContourFiles } from './use-contour-files';
import { useContourMap } from './use-contour-map';
import { useGeoreferenceKeys } from './use-georeference-keys';

// Начальный вид — центр Москвы: контур встаёт в центр карты, и его двигают к месту.
const START_BOUNDS: [number, number, number, number] = [37.56, 55.73, 37.68, 55.77];
const MAP_PADDING = { top: 24, right: 24, bottom: 24, left: 24 };

type Drawer = 'contour' | 'binding' | null;

export function GeoreferencePage(): JSX.Element {
  const dispatch = useAppDispatch();
  const session = useAppSelector(selectGeoreference);
  const placement = placementOf(session);
  const { imagery } = getRuntimeConfig();
  const options = basemapOptions(imagery);

  const [map, setMap] = useState<MapLibreMap | null>(null);
  // Без WebGL карты нет, а без карты совмещать не с чем: экран объясняет это вместо подсказки.
  const [mapUnavailable, setMapUnavailable] = useState(false);
  // Контур ставится на карту: пока её нет или она перестала отвечать, открывать файлы некуда.
  const canOpen = map !== null && !mapUnavailable;
  const [basemap, setBasemap] = useState<BasemapKind>('scheme');
  const [fillOpacity, setFillOpacity] = useState(DEFAULT_FILL_OPACITY);
  const [contourVisible, setContourVisible] = useState(true);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const readout = useRef<HTMLDivElement>(null);
  const narrow = useMediaQuery(`(max-width: ${PANELS_BREAKPOINT})`, false, {
    getInitialValueInEffect: false,
  });

  const { fit } = useContourMap({ map, placement, fillOpacity, contourVisible, readout });
  const files = useContourFiles({
    anchor: () => {
      if (map === null) return null;
      const { lat, lng } = map.getCenter();
      return { lat, lon: lng };
    },
    onLoaded: (loaded) => {
      setDrawer(null);
      fit(loaded);
    },
  });
  useGeoreferenceKeys({
    map,
    enabled: files.pendingReference === null && !(narrow && drawer !== null),
    contourLoaded: placement !== null,
  });

  // Подложка не отвечает — сообщение с названием источника: ни одного тайла за три секунды.
  useEffect(() => {
    if (map === null) return;
    const option = basemapOptions(getRuntimeConfig().imagery).find(({ kind }) => kind === basemap);
    if (option === undefined) return;
    return watchBasemap(map, option.sourceIds, (status) => {
      if (status !== 'unavailable') return;
      notifications.show({
        color: 'clay',
        message: `Подложка «${option.title}» не загрузилась: ${option.source} не отвечает. Проверьте сеть или выберите другую подложку.`,
      });
    });
  }, [map, basemap]);

  const contourPanel = (
    <ContourPanel
      session={session}
      fillOpacity={fillOpacity}
      onFillOpacity={setFillOpacity}
      contourVisible={contourVisible}
      onContourVisible={setContourVisible}
      onFiles={(dropped) => void files.open(dropped)}
      onExample={() => void files.openExample()}
      disabled={!canOpen}
      withTitle={!narrow}
      onFit={() => {
        fit();
      }}
    />
  );
  const bindingPanel = <BindingPanel placement={placement} withTitle={!narrow} />;

  return (
    <div className={classes.page}>
      <title>{`Геопривязка — ${PRODUCT_NAME}`}</title>
      <VisuallyHidden>
        <h1>Геопривязка</h1>
      </VisuallyHidden>

      {!narrow && <aside className={classes.panel}>{contourPanel}</aside>}

      <div className={classes.center}>
        <Group className={classes.toolbar}>
          {narrow && (
            <>
              <Button
                variant="default"
                onClick={() => {
                  setDrawer('contour');
                }}
              >
                Контур
              </Button>
              <Button
                variant="default"
                onClick={() => {
                  setDrawer('binding');
                }}
              >
                Привязка
              </Button>
            </>
          )}
          {options.length > 1 && (
            <SegmentedControl
              aria-label="Подложка"
              value={basemap}
              onChange={(value) => {
                const option = options.find(({ kind }) => kind === value);
                if (option !== undefined) setBasemap(option.kind);
              }}
              data={options.map(({ kind, title }) => ({ value: kind, label: title }))}
            />
          )}
          <span className={classes.spacer} />
          <ActionIcon.Group>
            <ActionIcon
              variant="default"
              size="lg"
              aria-label="Отменить (Ctrl+Z)"
              disabled={session.undoStack.length === 0}
              onClick={() => dispatch(georeferenceActions.undone())}
            >
              <Icon icon={IconArrowBackUp} />
            </ActionIcon>
            <ActionIcon
              variant="default"
              size="lg"
              aria-label="Повторить (Ctrl+Shift+Z)"
              disabled={session.redoStack.length === 0}
              onClick={() => dispatch(georeferenceActions.redone())}
            >
              <Icon icon={IconArrowForwardUp} />
            </ActionIcon>
          </ActionIcon.Group>
        </Group>

        <div className={classes.map}>
          <MapView
            bounds={START_BOUNDS}
            padding={MAP_PADDING}
            label={
              placement === null
                ? 'Карта геопривязки: контур не загружен'
                : `Карта геопривязки: контур «${placement.source.name}»`
            }
            basemap
            basemapVisible
            basemapKind={basemap}
            imagery={imagery}
            maxZoom={IMAGERY_MAX_ZOOM}
            onReady={setMap}
            onBasemapResolved={() => undefined}
            onUnavailable={() => {
              setMapUnavailable(true);
            }}
          >
            <div ref={readout} className={classes.readout} hidden />
            {mapUnavailable ? (
              <div className={classes.empty} role="alert">
                <Stack gap="sm">
                  <Text fw={600}>Карта не открылась или перестала отвечать</Text>
                  <Text size="sm" c="dimmed">
                    Карте нужен WebGL: браузер его не дал или потерял. Без карты контур совместить
                    не с чем. Обновите страницу; если не поможет — откройте её в Chromium или
                    Firefox с включённым аппаратным ускорением.
                  </Text>
                </Stack>
              </div>
            ) : (
              placement === null && (
                <div className={classes.empty}>
                  <Stack gap="sm">
                    <Text fw={600}>
                      Загрузите границу участка в координатах чертежа — GeoJSON с полигоном
                    </Text>
                    <Text size="sm" c="dimmed">
                      Перетащите файл в окно или выберите его в панели «Контур».
                    </Text>
                    <Button disabled={!canOpen} onClick={() => void files.openExample()}>
                      Открыть пример
                    </Button>
                  </Stack>
                </div>
              )
            )}
          </MapView>
        </div>

        <StatusBar map={map} />
      </div>

      {!narrow && <aside className={classes.panel}>{bindingPanel}</aside>}

      <Drawer
        opened={narrow && drawer === 'contour'}
        onClose={() => {
          setDrawer(null);
        }}
        title="Контур"
        position="left"
      >
        {contourPanel}
      </Drawer>
      <Drawer
        opened={narrow && drawer === 'binding'}
        onClose={() => {
          setDrawer(null);
        }}
        title="Привязка"
        position="right"
      >
        {bindingPanel}
      </Drawer>

      <Dropzone.FullScreen
        disabled={!canOpen}
        accept={GEOJSON_ACCEPT}
        multiple
        onDrop={(dropped) => void files.open(dropped)}
      >
        <div className={classes.fullscreenDrop}>Отпустите файл, чтобы открыть контур</div>
      </Dropzone.FullScreen>

      <Modal
        opened={files.pendingReference !== null}
        onClose={() => {
          files.answer(false);
        }}
        title="Открыть как эталон?"
      >
        {files.pendingReference !== null && (
          <Stack gap="md">
            <Text size="sm">
              {`«${files.pendingReference.fileName}» — результат привязки из этого модуля${files.pendingReference.created === null ? '' : `, выгружен ${files.pendingReference.created}`}. Его координаты — широта и долгота, поэтому контуром он не откроется.`}
            </Text>
            <Text size="sm">
              Эталон — ранее привязанный контур в его настоящем положении: с ним сравнивают новую
              привязку.
            </Text>
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => {
                  files.answer(false);
                }}
              >
                Не открывать
              </Button>
              <Button
                onClick={() => {
                  files.answer(true);
                }}
              >
                Открыть как эталон
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </div>
  );
}

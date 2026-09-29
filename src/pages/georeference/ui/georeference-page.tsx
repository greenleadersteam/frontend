import {
  ActionIcon,
  Button,
  Drawer,
  Group,
  Modal,
  Stack,
  Text,
  VisuallyHidden,
} from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { useMediaQuery, useWindowEvent } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconChevronDown,
  IconChevronUp,
} from '@tabler/icons-react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { type JSX, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import {
  georeferenceActions,
  georeferenceReducer,
  placementOf,
  projectGeoreference,
  selectGeoreference,
} from '@/entities/georeference';
import { isProjectId, usePutGeoreferenceMutation } from '@/entities/project';
import { PlaceSearch, showPlace } from '@/features/find-place';
import { describeAppError, toAppError } from '@/shared/api';
import { PRODUCT_NAME, projectPath } from '@/shared/config';
import { isLocked, isOutlier, stats as gcpStats } from '@/shared/lib/georeference';
import { useAppDispatch, useAppSelector } from '@/shared/lib/store';
import { IMAGERY_MAX_ZOOM, MapView } from '@/shared/map';
import { PANELS_BREAKPOINT } from '@/shared/theme';
import { Icon, NotFoundScreen } from '@/shared/ui';

import { FILE_REASON, isFileOrigin } from '../lib/project-contour';
import { BindingPanel } from './binding-panel';
import { CompareSection } from './compare-section';
import { DEFAULT_FILL_OPACITY } from './contour-layers';
import { ContourPanel, GEOJSON_ACCEPT } from './contour-panel';
import { ExportMenu } from './export-menu';
import { GcpSection, type VectorScale } from './gcp-section';
import classes from './georeference-page.module.css';
import { ProjectGeoreference, type ProjectMode } from './project-georeference';
import { ResidualsTable } from './residuals-table';
import { StatusBar } from './status-bar';
import { useContourFiles } from './use-contour-files';
import { useContourMap } from './use-contour-map';
import { type PendingPoint, useGcpMap } from './use-gcp-map';
import { useGeoreferenceKeys } from './use-georeference-keys';
import { useProjectOverlay } from './use-project-overlay';

// Начальный вид — центр Москвы: контур встаёт в центр карты, и его двигают к месту.
const START_BOUNDS: [number, number, number, number] = [37.56, 55.73, 37.68, 55.77];
const MAP_PADDING = { top: 24, right: 24, bottom: 24, left: 24 };

type Drawer = 'contour' | 'binding' | null;

const EMPTY_SESSION = georeferenceReducer(undefined, { type: 'georeference/empty' });

// Модуль открывается сам по себе — контур из файла — или из проекта: ?project=<id>.
export function GeoreferencePage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project');
  if (projectId === null) return <GeoreferenceWorkspace project={null} />;
  // Параметр адреса — внешние данные: проверяется, прежде чем уйти в запрос.
  if (!isProjectId(projectId)) return <NotFoundScreen />;
  return (
    <ProjectGeoreference key={projectId} id={projectId}>
      {(mode) => <GeoreferenceWorkspace project={mode} />}
    </ProjectGeoreference>
  );
}

type GeoreferenceWorkspaceProps = {
  // null — контур из файла; иначе — граница участка проекта и её прежняя привязка.
  project: ProjectMode | null;
};

function GeoreferenceWorkspace({ project }: GeoreferenceWorkspaceProps): JSX.Element {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const current = useAppSelector(selectGeoreference);
  // Сессия живёт в store приложения и переживает экран. Пока в ней контур не этого экрана
  // (файл из прошлого раза или другой проект, а карта ещё не готова открыть проект), экран её не
  // видит: иначе «Применить к проекту» и выгрузка взяли бы чужой контур.
  const session = current.projectId === (project?.project.id ?? null) ? current : EMPTY_SESSION;
  const placement = placementOf(session);

  const [map, setMap] = useState<MapLibreMap | null>(null);
  // Без WebGL карты нет, а без карты совмещать не с чем: экран объясняет это вместо подсказки.
  const [mapUnavailable, setMapUnavailable] = useState(false);
  // Контур ставится на карту: пока её нет или она перестала отвечать, открывать файлы некуда.
  const canOpen = map !== null && !mapUnavailable;
  const [fillOpacity, setFillOpacity] = useState(DEFAULT_FILL_OPACITY);
  const [contourVisible, setContourVisible] = useState(true);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const readout = useRef<HTMLDivElement>(null);
  // Режим расстановки опорных точек и первая точка незаконченной пары — состояние экрана.
  const [gcpActive, setGcpActive] = useState(false);
  const [pending, setPending] = useState<PendingPoint | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  // Множитель векторов невязок; ×50, как в прототипе.
  const [vectorScale, setVectorScale] = useState<VectorScale>(50);
  const [residualsOpen, setResidualsOpen] = useState(true);
  const [planVisible, setPlanVisible] = useState(true);
  const [putGeoreference, { isLoading: applying }] = usePutGeoreferenceMutation();
  // Контур проекта ставится в сессию один раз на открытие экрана — и когда в сессии остался тот же
  // проект с прошлого раза: брошенная правка прошлого открытия не продолжается.
  const openedRef = useRef(false);

  const locked = isLocked(session.gcp);
  const statistics =
    placement === null ? null : gcpStats(placement, session.gcp, session.workScale);
  const outliers = new Set(
    statistics?.rows.filter((row) => isOutlier(row, statistics)).map((row) => row.pair.id),
  );
  const narrow = useMediaQuery(`(max-width: ${PANELS_BREAKPOINT})`, false, {
    getInitialValueInEffect: false,
  });

  const { fit } = useContourMap({
    map,
    placement,
    fillOpacity,
    contourVisible,
    movable: !gcpActive && !locked,
    readout,
  });
  // До useGcpMap: слои плана ложатся под слои опорных точек и эталонов.
  useProjectOverlay({
    map,
    overlay: project?.overlay ?? null,
    placement,
    visible: planVisible,
  });
  useGcpMap({
    map,
    placement,
    gcp: session.gcp,
    rows: statistics?.rows ?? [],
    outliers,
    references: session.references,
    vectorScale,
    active: gcpActive && placement !== null,
    pending,
    onPending: setPending,
    hot,
    onHot: setHot,
  });
  const files = useContourFiles({
    // В режиме проекта контур — граница участка проекта: файлы открываются только эталонами.
    contourAllowed: project?.contour == null,
    projectId: project?.project.id ?? null,
    anchor: () => {
      if (map === null) return null;
      const { lat, lng } = map.getCenter();
      return { lat, lon: lng };
    },
    onLoaded: (loaded) => {
      setDrawer(null);
      // Первая точка пары относилась к прежнему контуру.
      setPending(null);
      fit(loaded);
    },
  });
  useGeoreferenceKeys({
    map,
    // Пока экран не видит сессию (режим проекта до готовой карты), отмена не трогает чужой контур.
    enabled:
      session !== EMPTY_SESSION && files.pendingReference === null && !(narrow && drawer !== null),
    contourLoaded: placement !== null && !locked,
  });

  // Esc сначала отменяет незаконченную пару, потом выходит из режима (прототип, gcp.js:41-45).
  useWindowEvent('keydown', (event) => {
    if (event.key !== 'Escape' || !gcpActive || files.pendingReference !== null) return;
    if (pending !== null) setPending(null);
    else setGcpActive(false);
  });

  // Сессия модуля живёт в store приложения: в режиме проекта она получает контур проекта, когда
  // готова карта (контур встаёт в её центр без поворота), а вне его контур проекта не остаётся.
  useEffect(() => {
    if (project === null) {
      if (current.projectId !== null) dispatch(georeferenceActions.projectClosed());
      return;
    }
    const { contour } = project;
    // Без контура в данных проекта его откроет файл пользователя.
    if (map === null || openedRef.current || contour === null) return;
    openedRef.current = true;
    const center = map.getCenter();
    const opened = {
      source: contour,
      anchor: { lat: center.lat, lon: center.lng },
      rotation: 0,
      scale: 1,
    };
    dispatch(
      georeferenceActions.projectOpened({
        projectId: project.project.id,
        contour,
        anchor: opened.anchor,
        rotation: opened.rotation,
        scale: opened.scale,
        gcp: [],
      }),
    );
    fit(opened);
  }, [map, project, current.projectId, dispatch, fit]);

  // Применить к проекту: привязка уходит на сервер, проект обрабатывается заново — назад к нему.
  const applyToProject = async () => {
    if (project === null || placement === null) return;
    const result = await putGeoreference({
      id: project.project.id,
      georeference: projectGeoreference(placement, session.gcp, session.workScale),
    });
    if ('error' in result) {
      notifications.show({ color: 'clay', message: describeAppError(toAppError(result.error)) });
      return;
    }
    notifications.show({ message: 'Привязка отправлена: проект обрабатывается заново' });
    void navigate(projectPath(project.project.id));
  };

  const contourPanel = (
    <ContourPanel
      project={
        project === null
          ? null
          : {
              name: project.project.name,
              origin: project.origin,
              plan: project.overlay !== null,
              planVisible,
              contourFromFile: project.contour === null,
            }
      }
      onPlanVisible={setPlanVisible}
      session={session}
      fillOpacity={fillOpacity}
      onFillOpacity={setFillOpacity}
      contourVisible={contourVisible}
      onContourVisible={setContourVisible}
      onFiles={(dropped) => void files.open(dropped)}
      onExample={() => void files.openExample()}
      disabled={!canOpen}
      locked={locked}
      withTitle={!narrow}
      onFit={() => {
        fit();
      }}
    />
  );
  const bindingPanel = (
    <BindingPanel placement={placement} locked={locked} withTitle={!narrow}>
      {placement !== null && (
        <GcpSection
          stats={statistics}
          workScale={session.workScale}
          handoff={session.handoff}
          locked={locked}
          active={gcpActive}
          pending={pending !== null}
          onToggle={() => {
            setGcpActive(!gcpActive);
            setPending(null);
          }}
          vectorScale={vectorScale}
          onVectorScale={setVectorScale}
        />
      )}
      <CompareSection placement={placement} references={session.references} />
      <ExportMenu placement={placement} gcp={session.gcp} workScale={session.workScale} />
      {project !== null && (
        <Group gap="sm">
          <Button
            loading={applying}
            disabled={placement === null}
            onClick={() => void applyToProject()}
          >
            Применить к проекту
          </Button>
          <Button
            variant="default"
            disabled={applying}
            onClick={() => void navigate(projectPath(project.project.id))}
          >
            Отмена
          </Button>
        </Group>
      )}
    </BindingPanel>
  );

  return (
    <div className={classes.page}>
      <title>
        {project === null
          ? `Геопривязка — ${PRODUCT_NAME}`
          : `Геопривязка — ${project.project.name} — ${PRODUCT_NAME}`}
      </title>
      <VisuallyHidden>
        <h1>
          {project === null ? 'Геопривязка' : `Геопривязка проекта «${project.project.name}»`}
        </h1>
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
          <PlaceSearch
            className={classes.search}
            onPick={(target) => {
              if (map !== null) showPlace(map, target);
            }}
          />
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
            basemapSwitch
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
              placement === null &&
              project?.contour == null && (
                <div className={classes.empty}>
                  <Stack gap="sm">
                    <Text fw={600}>
                      Загрузите границу участка в координатах чертежа — GeoJSON с полигоном
                    </Text>
                    <Text size="sm" c="dimmed">
                      {project === null
                        ? 'Перетащите файл в окно или выберите его в панели «Контур».'
                        : `${isFileOrigin(project.origin) ? `${FILE_REASON[project.origin]} ` : ''}Нужен файл в метрах, в тех же координатах, что DXF. Перетащите его в окно или выберите в панели «Контур».`}
                    </Text>
                    {project === null && (
                      <Button disabled={!canOpen} onClick={() => void files.openExample()}>
                        Открыть пример
                      </Button>
                    )}
                  </Stack>
                </div>
              )
            )}
          </MapView>
        </div>

        {statistics !== null && (session.gcp.length > 0 || gcpActive) && (
          <section
            className={classes.residualsPanel}
            data-collapsed={!residualsOpen || undefined}
            aria-labelledby="residuals-title"
          >
            <Group justify="space-between">
              <Text id="residuals-title" fw={600} size="sm">
                {`Невязки опорных точек: ${String(session.gcp.length)}`}
              </Text>
              <ActionIcon
                variant="subtle"
                aria-expanded={residualsOpen}
                aria-controls="residuals-body"
                aria-label={
                  residualsOpen ? 'Свернуть таблицу невязок' : 'Развернуть таблицу невязок'
                }
                onClick={() => {
                  setResidualsOpen(!residualsOpen);
                }}
              >
                <Icon icon={residualsOpen ? IconChevronDown : IconChevronUp} />
              </ActionIcon>
            </Group>
            <div id="residuals-body" className={classes.residualsBody} hidden={!residualsOpen}>
              {session.gcp.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Пар пока нет: щёлкните по контуру, затем по месту на карте.
                </Text>
              ) : (
                <ResidualsTable stats={statistics} hot={hot} onHot={setHot} />
              )}
            </div>
          </section>
        )}

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
        <div className={classes.fullscreenDrop}>
          {project?.contour == null
            ? 'Отпустите файл, чтобы открыть контур'
            : 'Отпустите выгрузку привязки, чтобы открыть её эталоном'}
        </div>
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

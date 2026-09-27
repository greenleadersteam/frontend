import {
  Alert,
  Button,
  Group,
  Modal,
  SegmentedControl,
  Skeleton,
  Stack,
  Text,
} from '@mantine/core';
import { useWindowEvent } from '@mantine/hooks';
import { type JSX, useState } from 'react';
import { useBlocker, useSearchParams } from 'react-router';

import {
  createLocalFrame,
  type ExplanationEntry,
  isGeographic,
  type Norm,
  type ObstaclesFeatureCollection,
  PlanCanvas,
  type PlantingStatus,
  plantingStatus,
  prepareObstacles,
  prepareZones,
  type Project,
  type RejectedSitesFeatureCollection,
  type ResultData,
  resultExtent,
  type Species,
  toMapData,
  toMapObstacles,
  useGetExplanationQuery,
  useGetNormsQuery,
  useGetObstaclesQuery,
  useGetPlantingQuery,
  useGetRejectedQuery,
  useGetSpeciesQuery,
  useGetZonesQuery,
} from '@/entities/project';
import {
  EditsLoadAlert,
  type FinalPlanting,
  StaleDraftAlert,
  useEditsLoader,
  usePlantingEdits,
} from '@/features/edit-plantings';
import { describeAppError, toAppError } from '@/shared/api';
import { BASEMAP_BOUNDS, useCapability } from '@/shared/config';

import { PlantingRegister } from './planting-register';
import { resultLabel } from './result-label';
import { type CenterRequest, ResultMap, type Selection } from './result-map';
import classes from './result-view.module.css';

type ResultViewProps = { project: Project };

type View = 'plan' | 'register';

const VIEW_PARAM = 'view';
const VIEWS = [
  { value: 'plan', label: 'План' },
  { value: 'register', label: 'Ведомость' },
];

// Параметр URL — внешние данные: всё, кроме register, — план.
const parseView = (value: string | null): View => (value === 'register' ? 'register' : 'plan');

export function ResultView({ project }: ResultViewProps): JSX.Element {
  // Объекты подосновы и справочник норм — из контракта-предложения: без объявленной
  // возможности запросы не уходят, а проверки считаются по зонам запрета.
  const withObstacles = useCapability('obstacles');
  const withNorms = useCapability('norms');
  const withSpecies = useCapability('species');
  const withRejected = useCapability('rejected');
  const planting = useGetPlantingQuery(project.id);
  const zones = useGetZonesQuery(project.id);
  const explanation = useGetExplanationQuery(project.id);
  const obstacles = useGetObstaclesQuery(project.id, { skip: !withObstacles });
  const norms = useGetNormsQuery(undefined, { skip: !withObstacles || !withNorms });
  const species = useGetSpeciesQuery(undefined, { skip: !withSpecies });
  const rejected = useGetRejectedQuery(project.id, { skip: !withRejected });
  const queries = [planting, zones, explanation];

  // Сбой /obstacles или /norms план не закрывает: без объектов проверки считаются по зонам
  // запрета, без справочника нормы берутся из зон. Так же без пород и отклонённых мест план
  // остаётся прежним.
  const error = planting.error ?? zones.error ?? explanation.error;
  if (error !== undefined) {
    return (
      <Stack gap="md" align="flex-start" justify="center" className={classes.area}>
        <Text role="alert">{describeAppError(toAppError(error))}</Text>
        <Button
          variant="default"
          loading={queries.some(({ isFetching }) => isFetching)}
          onClick={() => {
            for (const query of queries) if (query.isError) void query.refetch();
          }}
        >
          Повторить
        </Button>
      </Stack>
    );
  }
  if (
    planting.data === undefined ||
    zones.data === undefined ||
    explanation.data === undefined ||
    obstacles.isLoading ||
    norms.isLoading ||
    species.isLoading ||
    rejected.isLoading
  ) {
    return (
      <Skeleton
        className={classes.area}
        radius="xl"
        role="status"
        aria-busy="true"
        aria-label="Загрузка плана посадок"
      />
    );
  }
  return (
    <LoadedResult
      project={project}
      data={{ planting: planting.data, zones: zones.data }}
      explanation={explanation.data}
      obstacles={obstacles.data ?? null}
      norms={norms.data ?? null}
      // После повторного запроса с ошибкой RTK Query оставляет прежние данные: план строится
      // по ним, и пояснение о сбое было бы неправдой.
      failed={{
        obstacles: obstacles.isError && obstacles.data === undefined,
        rejected: rejected.isError && rejected.data === undefined,
        species: species.isError && species.data === undefined,
      }}
      species={species.data ?? []}
      rejected={rejected.data ?? null}
    />
  );
}

type LoadedResultProps = {
  project: Project;
  data: ResultData;
  explanation: ExplanationEntry[];
  obstacles: ObstaclesFeatureCollection | null;
  norms: Norm[] | null;
  // Сервер объявил возможность, но запрос не удался: план строится без этих данных.
  failed: { obstacles: boolean; rejected: boolean; species: boolean };
  species: Species[];
  // Отклонённые места (возможность rejected); null — сервер их не отдаёт.
  rejected: RejectedSitesFeatureCollection | null;
};

function LoadedResult({
  project,
  data,
  explanation,
  obstacles,
  norms,
  failed,
  species,
  rejected,
}: LoadedResultProps): JSX.Element {
  const notice = failureNotice(failed);
  useEditsLoader(project, data.planting);
  const edits = usePlantingEdits(project.id, data.planting);
  // Уход со страницы с правками, которых нет на сервере, спрашивает подтверждение. Смена вида
  // «План» / «Ведомость» меняет только параметры адреса и уходом не считается.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      edits.unsaved && currentLocation.pathname !== nextLocation.pathname,
  );
  // Закрытие и перезагрузка вкладки роутер не видит: о несохранённых правках спрашивает браузер.
  useWindowEvent('beforeunload', (event) => {
    if (edits.unsaved) event.preventDefault();
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseView(searchParams.get(VIEW_PARAM));
  const [selection, setSelection] = useState<Selection>(null);
  const [centerRequest, setCenterRequest] = useState<CenterRequest | null>(null);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  // Карта создаётся при первом показе плана: в скрытом контейнере нулевого размера MapLibre
  // не может вписать участок и остаётся на камере по умолчанию.
  const [planShown, setPlanShown] = useState(view === 'plan');
  if (view === 'plan' && !planShown) setPlanShown(true);
  // Ведомость тоже скрывается, а не размонтируется: фильтры, сортировка и страница
  // переживают переход на план и обратно.
  const [registerShown, setRegisterShown] = useState(view === 'register');
  if (view === 'register' && !registerShown) setRegisterShown(true);

  const extent = resultExtent(data);
  if (extent === null) {
    return <Text className={classes.area}>В результате обработки нет посадок и зон запрета.</Text>;
  }
  // Без геопривязки бэкенд отдаёт координаты чертежа с меткой CRS
  // (../backend/greenplan/export/geojson.py:18). Метка берётся из /zones: задеплоенный бэкенд
  // пока не отдаёт metadata в /planting.
  const geographic = isGeographic(data.zones.metadata.crs);
  // Охват и система координат — по расстановке сервиса: правка не сдвигает центр плана.
  const frame = createLocalFrame(extent, geographic);
  const edited = { planting: edits.final, zones: data.zones };
  const mapData = toMapData(edited, frame);
  const prepared = prepareZones(data.zones, frame);
  const objects =
    obstacles === null
      ? null
      : {
          map: toMapObstacles(obstacles, frame),
          prepared: prepareObstacles(obstacles, norms, data.zones, frame),
        };
  const entries = new Map(explanation.map((entry) => [entry.id, entry]));
  const statuses = plantingStatuses(edits.final, edits.serverStatuses, (point, plantType) =>
    plantingStatus(frame.toLocal(point), plantType, prepared, objects?.prepared ?? null),
  );
  const mapExtent = resultExtent(mapData) ?? extent;
  const [west, south, east, north] = BASEMAP_BOUNDS;
  const withinBasemap =
    geographic &&
    extent.minX >= west &&
    extent.minY >= south &&
    extent.maxX <= east &&
    extent.maxY <= north;

  const changeView = (next: View) => {
    setSearchParams(
      (params) => {
        if (next === 'register') params.set(VIEW_PARAM, next);
        else params.delete(VIEW_PARAM);
        return params;
      },
      { replace: true },
    );
  };

  const openOnPlan = (target: CenterRequest['target']) => {
    setSelection(target);
    setCenterRequest((previous) => ({ target, nonce: (previous?.nonce ?? 0) + 1 }));
    changeView('plan');
  };

  return (
    <Stack gap="md" className={classes.result}>
      <SegmentedControl
        data={VIEWS}
        value={view}
        onChange={(value) => {
          changeView(parseView(value));
        }}
        aria-label="Вид результата"
        className={classes.switch}
      />
      <EditsLoadAlert projectId={project.id} />
      <StaleDraftAlert projectId={project.id} />
      {/* План в ведомости скрыт, а не размонтирован: камера и выбор сохраняются. */}
      <div hidden={view !== 'plan'} className={classes.plan}>
        {notice !== null && (
          <Text size="sm" c="dimmed" className={classes.notice}>
            {notice}
          </Text>
        )}
        {mapUnavailable ? (
          <Stack gap="md" className={classes.fallback}>
            <Alert color="stone" variant="light">
              <Text size="sm">Карта недоступна в этом браузере. Показан план посадок.</Text>
            </Alert>
            <div className={classes.area} data-plan>
              <PlanCanvas
                planting={edited.planting}
                zones={edited.zones}
                label={resultLabel(edited)}
              />
            </div>
          </Stack>
        ) : (
          planShown && (
            <ResultMap
              projectId={project.id}
              source={data.planting}
              data={edited}
              statuses={statuses}
              mapData={mapData}
              bounds={[mapExtent.minX, mapExtent.minY, mapExtent.maxX, mapExtent.maxY]}
              frame={frame}
              prepared={prepared}
              obstacles={objects}
              explanation={entries}
              species={new Map(species.map((item) => [item.id, item]))}
              rejected={rejected}
              basemap={withinBasemap}
              selection={selection}
              onSelect={setSelection}
              centerRequest={centerRequest}
              visible={view === 'plan'}
              onUnavailable={() => {
                setMapUnavailable(true);
              }}
            />
          )
        )}
      </div>
      {registerShown && (
        <div hidden={view !== 'register'}>
          <PlantingRegister
            project={project}
            planting={edits.final}
            statuses={statuses}
            counts={edits.counts}
            explanation={entries}
            prepared={prepared}
            geographic={geographic}
            rejected={rejected}
            // Запасной план выбор не показывает: переход к нему ничего бы не дал.
            onOpen={mapUnavailable ? null : openOnPlan}
          />
        </div>
      )}
      <Modal
        opened={blocker.state === 'blocked'}
        onClose={() => {
          blocker.reset?.();
        }}
        title="Уйти со страницы?"
      >
        <Stack gap="lg">
          <Text>
            Правки расстановки не сохранены на сервере. Они останутся в этой вкладке, но пропадут
            при её закрытии или перезагрузке.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              onClick={() => {
                blocker.reset?.();
              }}
            >
              Остаться
            </Button>
            <Button
              color="clay"
              onClick={() => {
                blocker.proceed?.();
              }}
            >
              Уйти без сохранения
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

// Статусы для карты и ведомости. После сохранения первичны статусы сервера; у правленых
// посадок — свой расчёт, и в dev его расхождение с сервером видно в консоли, как в Б2.
// У неправленых без ответа сервера статуса нет: это allowed расстановки сервиса.
function plantingStatuses(
  final: FinalPlanting,
  server: ReadonlyMap<string, PlantingStatus> | null,
  statusOf: (point: readonly number[], plantType: 'tree' | 'shrub') => PlantingStatus,
): Map<string, PlantingStatus> {
  const statuses = new Map<string, PlantingStatus>();
  for (const { geometry, properties } of final.features) {
    const changed = properties.origin === 'manual' || properties.moved_from !== null;
    const own = changed ? statusOf(geometry.coordinates, properties.plant_type) : null;
    const saved = server?.get(properties.id);
    if (saved !== undefined) {
      if (import.meta.env.DEV && own !== null && own !== saved) {
        // eslint-disable-next-line no-console -- сигнал разработчику о расхождении реализаций, только в dev
        console.warn(`Статус ${properties.id}: сервер ${saved}, клиент ${own}`);
      }
      statuses.set(properties.id, saved);
    } else if (own !== null) {
      statuses.set(properties.id, own);
    }
  }
  return statuses;
}

// Что из объявленного сервером не загрузилось и что это значит для плана.
function failureNotice(failed: LoadedResultProps['failed']): string | null {
  const others = [
    ...(failed.rejected ? ['отклонённые места'] : []),
    ...(failed.species ? ['породы посадок'] : []),
  ];
  if (!failed.obstacles && others.length === 0) return null;
  return [
    ...(failed.obstacles
      ? ['Объекты подосновы не загрузились: проверки посчитаны по зонам запрета.']
      : []),
    ...(others.length > 0 ? [`Не загрузились ${others.join(' и ')}.`] : []),
    'Обновите страницу, чтобы загрузить их снова.',
  ].join(' ');
}

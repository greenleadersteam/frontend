import { Alert, Button, SegmentedControl, Skeleton, Stack, Text } from '@mantine/core';
import { type JSX, useState } from 'react';
import { useSearchParams } from 'react-router';

import {
  createLocalFrame,
  type ExplanationEntry,
  isGeographic,
  type Norm,
  type ObstaclesFeatureCollection,
  PlanCanvas,
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
  const frame = createLocalFrame(extent, geographic);
  const mapData = toMapData(data, frame);
  const prepared = prepareZones(data.zones, frame);
  const objects =
    obstacles === null
      ? null
      : {
          map: toMapObstacles(obstacles, frame),
          prepared: prepareObstacles(obstacles, norms, data.zones, frame),
        };
  const entries = new Map(explanation.map((entry) => [entry.id, entry]));
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
              <PlanCanvas planting={data.planting} zones={data.zones} label={resultLabel(data)} />
            </div>
          </Stack>
        ) : (
          planShown && (
            <ResultMap
              data={data}
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
            planting={data.planting}
            explanation={entries}
            prepared={prepared}
            geographic={geographic}
            rejected={rejected}
            // Запасной план выбор не показывает: переход к нему ничего бы не дал.
            onOpen={mapUnavailable ? null : openOnPlan}
          />
        </div>
      )}
    </Stack>
  );
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

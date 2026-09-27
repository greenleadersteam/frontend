import { Alert, Button, SegmentedControl, Skeleton, Stack, Text } from '@mantine/core';
import { type JSX, useState } from 'react';
import { useSearchParams } from 'react-router';

import {
  createLocalFrame,
  type ExplanationEntry,
  isGeographic,
  PlanCanvas,
  prepareZones,
  type Project,
  type ResultData,
  resultExtent,
  toMapData,
  useGetExplanationQuery,
  useGetPlantingQuery,
  useGetZonesQuery,
} from '@/entities/project';
import { describeAppError, toAppError } from '@/shared/api';
import { BASEMAP_BOUNDS } from '@/shared/config';

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
  const planting = useGetPlantingQuery(project.id);
  const zones = useGetZonesQuery(project.id);
  const explanation = useGetExplanationQuery(project.id);
  const queries = [planting, zones, explanation];

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
  if (planting.data === undefined || zones.data === undefined || explanation.data === undefined) {
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
    />
  );
}

type LoadedResultProps = {
  project: Project;
  data: ResultData;
  explanation: ExplanationEntry[];
};

function LoadedResult({ project, data, explanation }: LoadedResultProps): JSX.Element {
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

  const openOnPlan = (id: string) => {
    setSelection({ kind: 'planting', id });
    setCenterRequest((previous) => ({ id, nonce: (previous?.nonce ?? 0) + 1 }));
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
              explanation={entries}
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
            // Запасной план выбор не показывает: переход к нему ничего бы не дал.
            onOpen={mapUnavailable ? null : openOnPlan}
          />
        </div>
      )}
    </Stack>
  );
}

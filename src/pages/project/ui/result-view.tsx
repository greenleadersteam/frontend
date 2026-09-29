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
import { type JSX, type ReactNode, useState } from 'react';
import { Link, useBlocker, useSearchParams } from 'react-router';

import {
  PlanCanvas,
  type Project,
  resultExtent,
  toMapPlanting,
  toMapZones,
} from '@/entities/project';
import {
  EditsLoadAlert,
  type FinalPlanting,
  StaleDraftAlert,
  useEditsLoader,
  usePlantingEdits,
} from '@/features/edit-plantings';
import { describeAppError } from '@/shared/api';
import { BASEMAP_BOUNDS, georeferenceProjectPath, useCapability } from '@/shared/config';

import {
  type EditedResult,
  editedResult,
  type LoadedResult,
  type ResultBase,
  resultBase,
  useResultData,
} from '../model/result';
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

const DRAWING_NOTE = 'Координаты чертежа, без привязки к городу';
const OUTSIDE_BASEMAP_NOTE = 'Участок за пределами карты Москвы, подложки нет';

// Параметр URL — внешние данные: всё, кроме register, — план.
const parseView = (value: string | null): View => (value === 'register' ? 'register' : 'plan');

export function ResultView({ project }: ResultViewProps): JSX.Element {
  const state = useResultData(project);
  switch (state.kind) {
    case 'error':
      return (
        <Stack gap="md" align="flex-start" justify="center" className={classes.area}>
          <Text role="alert">{describeAppError(state.error)}</Text>
          <Button variant="default" loading={state.retrying} onClick={state.retry}>
            Повторить
          </Button>
        </Stack>
      );
    case 'loading':
      return (
        <Skeleton
          className={classes.area}
          radius="xl"
          role="status"
          aria-busy="true"
          aria-label="Загрузка плана посадок"
        />
      );
    case 'ready':
      return <LoadedScreen project={project} result={state.result} />;
    default: {
      const unexpected: never = state;
      return unexpected;
    }
  }
}

type PreparedResultProps = { project: Project; result: LoadedResult };

// Правки грузятся, как только есть расстановка сервиса, — и при пустом результате: иначе кнопка
// «Править расстановку» в шапке ждала бы их вечно.
function LoadedScreen({ project, result }: PreparedResultProps): JSX.Element {
  useEditsLoader(project, result.data.planting);
  return <PreparedResult project={project} result={result} />;
}

// Экран результата — три уровня, чтобы тяжёлое не считалось на каждый щелчок. React Compiler
// кеширует вычисление по его зависимостям, но в компоненте с хуками и состоянием выбора сливает
// их в одну область, и выбор посадки пересчитывал бы всё. Поэтому:
// - PreparedResult — зоны и объекты участка (у «Олимпийского» 1,1 млн вершин), зоны на карте
//   и охват плана: один раз на результат;
// - EditedScreen и EditedData — итоговая расстановка со статусами и посадки на карте: только
//   при смене итоговой расстановки, а не режима правки или инструмента;
// - ResultBody — вид, выбор и режимы: на каждый щелчок, без пересчёта данных.
function PreparedResult({ project, result }: PreparedResultProps): JSX.Element {
  const base = resultBase(result);
  if (base === null) {
    return <Text className={classes.area}>В результате обработки нет посадок и зон запрета.</Text>;
  }
  const mapZones = toMapZones(base.zones, base.frame);
  // Охват плана — по расстановке сервиса и зонам: он задаёт камеру и подложку, а правка
  // посадки их не меняет.
  const mapExtent =
    resultExtent({ planting: toMapPlanting(result.data.planting, base.frame), zones: mapZones }) ??
    base.extent;
  return (
    <EditedScreen
      project={project}
      result={result}
      base={base}
      mapZones={mapZones}
      mapExtent={mapExtent}
    />
  );
}

type EditedScreenProps = PreparedResultProps & {
  base: ResultBase;
  mapZones: ReturnType<typeof toMapZones>;
  mapExtent: NonNullable<ReturnType<typeof resultExtent>>;
};

// Хуки правок — отдельно от расчёта: их объект новый на каждое изменение записи (режим,
// инструмент), а расчёту нужна только итоговая расстановка из селектора с кешем.
function EditedScreen(props: EditedScreenProps): JSX.Element {
  const { final } = usePlantingEdits(props.project.id, props.result.data.planting);
  return <EditedData {...props} final={final} />;
}

type EditedDataProps = EditedScreenProps & { final: FinalPlanting };

function EditedData({
  project,
  result,
  base,
  mapZones,
  mapExtent,
  final,
}: EditedDataProps): JSX.Element {
  const edited = editedResult(base, { final });
  return (
    <ResultBody
      project={project}
      result={result}
      edited={edited}
      mapData={{
        ...edited.edited,
        planting: toMapPlanting(edited.edited.planting, edited.frame),
        zones: mapZones,
      }}
      mapExtent={mapExtent}
    />
  );
}

type ResultBodyProps = PreparedResultProps & {
  edited: EditedResult;
  mapData: EditedResult['edited'];
  mapExtent: NonNullable<ReturnType<typeof resultExtent>>;
};

function ResultBody({
  project,
  result,
  edited: editedData,
  mapData,
  mapExtent,
}: ResultBodyProps): JSX.Element {
  const edits = usePlantingEdits(project.id, result.data.planting);
  const { data, failed, species, rejected } = result;
  const speciesById = new Map(species.map((item) => [item.id, item]));
  const notice = failureNotice(failed);
  // Привязать проект к карте из модуля может только сервер (следующая версия; в «Демо» — как цель).
  const bindable = useCapability('manualGeoreference');
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
  const { geographic, frame, edited, prepared, obstacles: objects, entries, statuses } = editedData;
  const [west, south, east, north] = BASEMAP_BOUNDS;
  const withinBasemap =
    frame.onCity &&
    mapExtent.minX >= west &&
    mapExtent.minY >= south &&
    mapExtent.maxX <= east &&
    mapExtent.maxY <= north;
  const note: ReactNode = withinBasemap ? undefined : geographic ? (
    OUTSIDE_BASEMAP_NOTE
  ) : (
    <>
      {DRAWING_NOTE}
      {bindable && (
        <Button
          component={Link}
          to={georeferenceProjectPath(project.id)}
          variant="subtle"
          size="compact-xs"
        >
          Привязать к карте
        </Button>
      )}
    </>
  );

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
              species={speciesById}
              rejected={rejected}
              basemap={withinBasemap}
              note={note}
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
            species={speciesById}
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

// Что из объявленного сервером не загрузилось и что это значит для плана.
function failureNotice(failed: LoadedResult['failed']): string | null {
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

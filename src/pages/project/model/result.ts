import {
  checksAgainstObstacles,
  checksForPlanting,
  createLocalFrame,
  type ExplanationEntry,
  isGeographic,
  type LocalFrame,
  type Norm,
  type ObstaclesFeatureCollection,
  type PlantingCheck,
  type PlantingStatus,
  plantingStatus,
  type PlantType,
  type PreparedObstacles,
  type PreparedZones,
  prepareObstacles,
  prepareZones,
  type Project,
  type RejectedSitesFeatureCollection,
  type ResultData,
  resultExtent,
  SERVICE_VERSION,
  type Species,
  toMapObstacles,
  useGetExplanationQuery,
  useGetNormsQuery,
  useGetObstaclesQuery,
  useGetPlantingQuery,
  useGetPlantingVersionQuery,
  useGetRejectedQuery,
  useGetServiceExplanationQuery,
  useGetSpeciesQuery,
  useGetZonesQuery,
} from '@/entities/project';
import type { FinalPlanting } from '@/features/edit-plantings';
import { type AppError, toAppError } from '@/shared/api';
import { useCapability } from '@/shared/config';

// Результат обработки со всем, что сервер отдаёт сверх /planting и /zones.
export type LoadedResult = {
  data: ResultData;
  explanation: ExplanationEntry[];
  obstacles: ObstaclesFeatureCollection | null;
  norms: Norm[] | null;
  species: Species[];
  // Отклонённые места (возможность rejected); null — сервер их не отдаёт.
  rejected: RejectedSitesFeatureCollection | null;
  // Сервер объявил возможность, но запрос не удался: план строится без этих данных.
  failed: { obstacles: boolean; rejected: boolean; species: boolean };
};

export type ResultState =
  | { kind: 'loading' }
  | { kind: 'error'; error: AppError; retrying: boolean; retry: () => void }
  | { kind: 'ready'; result: LoadedResult };

// Загрузка результата: экран проекта, меню скачивания и отчёт берут его из одного кэша.
// Объекты подосновы и справочник норм — из контракта-предложения: без объявленной возможности
// запросы не уходят, а проверки считаются по зонам запрета.
export function useResultData(project: Project): ResultState {
  const withObstacles = useCapability('obstacles');
  const withNorms = useCapability('norms');
  const withSpecies = useCapability('species');
  const withRejected = useCapability('rejected');
  const withVersions = useCapability('plantingEdits');
  // С версиями плана посадок /planting отдаёт последнюю версию, а правки считаются от
  // расстановки сервиса — версии 1.
  const latest = useGetPlantingQuery(project.id, { skip: withVersions });
  const service = useGetPlantingVersionQuery(
    { id: project.id, version: SERVICE_VERSION },
    { skip: !withVersions },
  );
  const planting = withVersions ? service : latest;
  const zones = useGetZonesQuery(project.id);
  // Объяснения — той же расстановки сервиса: с версиями /explanation отдаёт последнюю версию.
  const latestExplanation = useGetExplanationQuery(project.id, { skip: withVersions });
  const serviceExplanation = useGetServiceExplanationQuery(project.id, { skip: !withVersions });
  const explanation = withVersions ? serviceExplanation : latestExplanation;
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
    return {
      kind: 'error',
      error: toAppError(error),
      retrying: queries.some(({ isFetching }) => isFetching),
      retry: () => {
        for (const query of queries) if (query.isError) void query.refetch();
      },
    };
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
    return { kind: 'loading' };
  }
  return {
    kind: 'ready',
    result: {
      data: { planting: planting.data, zones: zones.data },
      explanation: explanation.data,
      obstacles: obstacles.data ?? null,
      norms: norms.data ?? null,
      species: species.data ?? [],
      rejected: rejected.data ?? null,
      // После повторного запроса с ошибкой RTK Query оставляет прежние данные: план строится
      // по ним, и пояснение о сбое было бы неправдой.
      failed: {
        obstacles: obstacles.isError && obstacles.data === undefined,
        rejected: rejected.isError && rejected.data === undefined,
        species: species.isError && species.data === undefined,
      },
    },
  };
}

export type MapObstacles = { map: ObstaclesFeatureCollection; prepared: PreparedObstacles };

// Всё, что считается по результату сервиса без правок: система координат, подготовленные зоны
// и объекты. Считается один раз на результат и привязку — правка посадки его не пересчитывает.
export type ResultBase = {
  // Охват расстановки сервиса: по нему строится система координат плана.
  extent: NonNullable<ReturnType<typeof resultExtent>>;
  geographic: boolean;
  frame: LocalFrame;
  zones: ResultData['zones'];
  prepared: PreparedZones;
  obstacles: MapObstacles | null;
  entries: Map<string, ExplanationEntry>;
};

// Итоговый результат: расстановка сервиса с правками и всё, что по ней считается.
export type EditedResult = ResultBase & {
  // Итоговая расстановка и зоны сервиса.
  edited: { planting: FinalPlanting; zones: ResultData['zones'] };
  statuses: Map<string, PlantingStatus>;
};

// null — в результате нет ни посадок, ни зон запрета: охвата нет.
export function resultBase({
  data,
  explanation,
  obstacles,
  norms,
}: LoadedResult): ResultBase | null {
  const extent = resultExtent(data);
  if (extent === null) return null;
  // Без геопривязки бэкенд отдаёт координаты чертежа с меткой CRS
  // (../backend/greenplan/export/geojson.py:18). Метка берётся из /zones: задеплоенный бэкенд
  // пока не отдаёт metadata в /planting.
  const geographic = isGeographic(data.zones.metadata.crs);
  // Охват и система координат — по расстановке сервиса: правка не сдвигает центр плана.
  const frame = createLocalFrame(extent, geographic);
  return {
    extent,
    geographic,
    frame,
    zones: data.zones,
    prepared: prepareZones(data.zones, frame),
    obstacles:
      obstacles === null
        ? null
        : {
            map: toMapObstacles(obstacles, frame),
            prepared: prepareObstacles(obstacles, norms, data.zones, frame),
          },
    entries: new Map(explanation.map((entry) => [entry.id, entry])),
  };
}

export function editedResult(base: ResultBase, edits: { final: FinalPlanting }): EditedResult {
  const { frame, prepared, obstacles } = base;
  return {
    ...base,
    edited: { planting: edits.final, zones: base.zones },
    statuses: plantingStatuses(edits.final, (point, plantType) =>
      plantingStatus(frame.toLocal(point), plantType, prepared, obstacles?.prepared ?? null),
    ),
  };
}

// Статусы для карты и ведомости — только у правленых посадок: в API версий статусов нет,
// а у неправленых это allowed расстановки сервиса.
function plantingStatuses(
  final: FinalPlanting,
  statusOf: (point: readonly number[], plantType: PlantType) => PlantingStatus,
): Map<string, PlantingStatus> {
  const statuses = new Map<string, PlantingStatus>();
  for (const { geometry, properties } of final.features) {
    if (properties.origin === 'manual' || properties.moved_from !== null) {
      statuses.set(properties.id, statusOf(geometry.coordinates, properties.plant_type));
    }
  }
  return statuses;
}

// Проверки считаются по данным бэкенда, не по координатам карты: у плана без геопривязки
// координаты карты условные. Есть объекты подосновы — расстояние до них прямое, иначе — через
// зоны запрета. У перемещённой и добавленной /explanation описывает исходную точку или ничего:
// её серверные проверки не передаются.
export function plantingChecks(
  feature: FinalPlanting['features'][number],
  entry: ExplanationEntry | undefined,
  { frame, prepared, obstacles }: Pick<EditedResult, 'frame' | 'prepared' | 'obstacles'>,
): PlantingCheck[] {
  const point = frame.toLocal(feature.geometry.coordinates);
  const { plant_type: plantType, origin, moved_from: movedFrom } = feature.properties;
  const changed = origin === 'manual' || movedFrom !== null;
  return obstacles === null
    ? checksForPlanting(point, plantType, prepared)
    : checksAgainstObstacles(
        point,
        plantType,
        changed ? undefined : entry?.checks,
        obstacles.prepared,
      );
}

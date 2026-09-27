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
  type Species,
  toMapObstacles,
  useGetExplanationQuery,
  useGetNormsQuery,
  useGetObstaclesQuery,
  useGetPlantingQuery,
  useGetRejectedQuery,
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

// Итоговый результат: расстановка сервиса с правками и всё, что по ней считается.
export type EditedResult = {
  // Охват расстановки сервиса: по нему строится система координат плана.
  extent: NonNullable<ReturnType<typeof resultExtent>>;
  geographic: boolean;
  frame: LocalFrame;
  // Итоговая расстановка и зоны сервиса.
  edited: { planting: FinalPlanting; zones: ResultData['zones'] };
  prepared: PreparedZones;
  obstacles: MapObstacles | null;
  entries: Map<string, ExplanationEntry>;
  statuses: Map<string, PlantingStatus>;
};

// null — в результате нет ни посадок, ни зон запрета: охвата нет.
export function editedResult(
  { data, explanation, obstacles, norms }: LoadedResult,
  edits: { final: FinalPlanting; serverStatuses: ReadonlyMap<string, PlantingStatus> | null },
): EditedResult | null {
  const extent = resultExtent(data);
  if (extent === null) return null;
  // Без геопривязки бэкенд отдаёт координаты чертежа с меткой CRS
  // (../backend/greenplan/export/geojson.py:18). Метка берётся из /zones: задеплоенный бэкенд
  // пока не отдаёт metadata в /planting.
  const geographic = isGeographic(data.zones.metadata.crs);
  // Охват и система координат — по расстановке сервиса: правка не сдвигает центр плана.
  const frame = createLocalFrame(extent, geographic);
  const prepared = prepareZones(data.zones, frame);
  const objects =
    obstacles === null
      ? null
      : {
          map: toMapObstacles(obstacles, frame),
          prepared: prepareObstacles(obstacles, norms, data.zones, frame),
        };
  return {
    extent,
    geographic,
    frame,
    edited: { planting: edits.final, zones: data.zones },
    prepared,
    obstacles: objects,
    entries: new Map(explanation.map((entry) => [entry.id, entry])),
    statuses: plantingStatuses(edits.final, edits.serverStatuses, (point, plantType) =>
      plantingStatus(frame.toLocal(point), plantType, prepared, objects?.prepared ?? null),
    ),
  };
}

// Статусы для карты и ведомости. После сохранения первичны статусы сервера; у правленых
// посадок — свой расчёт, и в dev его расхождение с сервером видно в консоли, как в Б2.
// У неправленых без ответа сервера статуса нет: это allowed расстановки сервиса.
function plantingStatuses(
  final: FinalPlanting,
  server: ReadonlyMap<string, PlantingStatus> | null,
  statusOf: (point: readonly number[], plantType: PlantType) => PlantingStatus,
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

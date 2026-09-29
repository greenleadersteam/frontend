import { type ApiComponents, baseApi, type ProposedApiComponents } from '@/shared/api';

type Schemas = ProposedApiComponents['schemas'];
type RealSchemas = ApiComponents['schemas'];
// Объяснения и посадки — типы контракта-предложения: базовый формат в них тот же, что
// ExplanationEntry и PlantingFeatureCollection в OpenAPI бэкенда, а добавочно — checks
// (explanationChecks) и порода species_* (species). Поля правок версии, которые экран не читает
// (kind, moved, displacement_m, zone_check, note и др.), в них не описаны.
export type ExplanationEntry = Schemas['ExplanationEntry'];
export type ZonesFeatureCollection = Schemas['ZonesFeatureCollection'];
export type PlantingFeatureCollection = Schemas['PlantingFeatureCollection'];
// Возможности obstacles и norms (contracts/openapi.proposed.yaml): без них запросы не уходят.
export type ObstaclesFeatureCollection = Schemas['ObstaclesFeatureCollection'];
export type Norm = Schemas['Norm'];
// Возможности species и rejected.
export type Species = Schemas['Species'];
export type RejectedSitesFeatureCollection = Schemas['RejectedSitesFeatureCollection'];
// Возможность plantingEdits: версии плана посадок — по OpenAPI бэкенда (afc4e23). Посадки версии —
// в формате /planting: у сервера это тот же PlantingFeatureCollection
// (../backend/greenplan/api/app.py, get_planting_version).
export type PlantingVersion = RealSchemas['PlantingVersion'];
export type PlantingEdit = RealSchemas['PlantingEdit'];
type PlantingEditResponse = RealSchemas['PlantingEditResponse'];

// Версия 1 — расстановка обработки: новая обработка удаляет прежние версии вместе с результатом
// (../backend/greenplan/api/jobs.py, run_processing_job), и других версий kind: auto нет.
export const SERVICE_VERSION = 1;

const resultTag = (id: string) => [{ type: 'ProjectResult', id }] as const;
// Правка меняет список версий и последнюю версию в /planting, но не зоны и не объяснения.
const versionsTag = (id: string) => [{ type: 'PlantingVersions', id }] as const;
const resultUrl = (id: string, resource: string) =>
  `/projects/${encodeURIComponent(id)}/${resource}`;

// Результат обработки проекта. Запрашивается только у проекта в статусе ready: до этого
// бэкенд отвечает 404 так же, как на «проекта нет» (../backend/greenplan/api/app.py:48-54).
export const projectResultApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // /explanation — последняя версия: если её объяснения сервер ещё собирает, он отвечает 202
    // с телом о сборке (app.py, _version_file). Это не данные, а ошибка «Повторить».
    getExplanation: build.query<ExplanationEntry[], string>({
      query: (id) => ({
        url: resultUrl(id, 'explanation'),
        validateStatus: (response) => response.status === 200,
      }),
      providesTags: (_result, _error, id) => resultTag(id),
    }),
    // С версиями /explanation — последняя версия, а у правленой объяснение сервер генерирует
    // в фоне и отвечает 202. Объяснения расстановки сервиса — у версии 1, она готова всегда.
    getServiceExplanation: build.query<ExplanationEntry[], string>({
      query: (id) => resultUrl(id, `plantings/${String(SERVICE_VERSION)}/explanation`),
      providesTags: (_result, _error, id) => resultTag(id),
    }),
    getZones: build.query<ZonesFeatureCollection, string>({
      query: (id) => resultUrl(id, 'zones'),
      providesTags: (_result, _error, id) => resultTag(id),
    }),
    getPlanting: build.query<PlantingFeatureCollection, string>({
      query: (id) => resultUrl(id, 'planting'),
      providesTags: (_result, _error, id) => [...resultTag(id), ...versionsTag(id)],
    }),
    getObstacles: build.query<ObstaclesFeatureCollection, string>({
      query: (id) => resultUrl(id, 'obstacles'),
      providesTags: (_result, _error, id) => resultTag(id),
    }),
    getRejected: build.query<RejectedSitesFeatureCollection, string>({
      query: (id) => resultUrl(id, 'rejected'),
      providesTags: (_result, _error, id) => resultTag(id),
    }),
    getPlantingVersions: build.query<PlantingVersion[], string>({
      query: (id) => resultUrl(id, 'plantings'),
      providesTags: (_result, _error, id) => [...resultTag(id), ...versionsTag(id)],
    }),
    // Версия не меняется: её кэш сбрасывает только новая обработка.
    getPlantingVersion: build.query<PlantingFeatureCollection, { id: string; version: number }>({
      query: ({ id, version }) => resultUrl(id, `plantings/${String(version)}`),
      providesTags: (_result, _error, { id }) => resultTag(id),
    }),
    editPlantingVersion: build.mutation<
      PlantingVersion,
      { id: string; version: number; edit: PlantingEdit }
    >({
      query: ({ id, version, edit }) => ({
        url: resultUrl(id, `plantings/${String(version)}/edit`),
        method: 'POST',
        body: edit,
      }),
      // Ответ сервера — созданная версия и id, выданные добавленным посадкам; нужна версия.
      transformResponse: (response: PlantingEditResponse) => response.version,
      invalidatesTags: (_result, _error, { id }) => versionsTag(id),
    }),
    // Справочники норм и пород общие для всех проектов.
    getNorms: build.query<Norm[], undefined>({ query: () => '/norms' }),
    getSpecies: build.query<Species[], undefined>({ query: () => '/species' }),
  }),
});

export const {
  useEditPlantingVersionMutation,
  useGetExplanationQuery,
  useGetNormsQuery,
  useGetObstaclesQuery,
  useGetPlantingQuery,
  useGetPlantingVersionQuery,
  useGetPlantingVersionsQuery,
  useGetRejectedQuery,
  useGetServiceExplanationQuery,
  useGetSpeciesQuery,
  useGetZonesQuery,
  useLazyGetPlantingVersionQuery,
} = projectResultApi;

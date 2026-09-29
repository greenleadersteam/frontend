import { baseApi, type ProposedApiComponents } from '@/shared/api';

type Schemas = ProposedApiComponents['schemas'];
// В OpenAPI бэкенда у /explanation нет схемы ответа; контракт-предложение описывает текущий
// формат (../backend/greenplan/explain/builder.py:17-32) и добавочное поле checks, задача P2-1.
export type ExplanationEntry = Schemas['ExplanationEntry'];
export type ZonesFeatureCollection = Schemas['ZonesFeatureCollection'];
export type PlantingFeatureCollection = Schemas['PlantingFeatureCollection'];
// Возможности obstacles и norms (contracts/openapi.proposed.yaml): без них запросы не уходят.
export type ObstaclesFeatureCollection = Schemas['ObstaclesFeatureCollection'];
export type Norm = Schemas['Norm'];
// Возможности species и rejected.
export type Species = Schemas['Species'];
export type RejectedSitesFeatureCollection = Schemas['RejectedSitesFeatureCollection'];
// Возможность plantingEdits: версии плана посадок.
export type PlantingVersion = Schemas['PlantingVersion'];
export type PlantingVersionFeatureCollection = Schemas['PlantingVersionFeatureCollection'];
export type PlantingEdit = Schemas['PlantingEdit'];

// Версия 1 — расстановка обработки: новая обработка начинает историю заново, и других версий
// kind: auto нет (contracts/openapi.proposed.yaml, /plantings).
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
    getExplanation: build.query<ExplanationEntry[], string>({
      query: (id) => resultUrl(id, 'explanation'),
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
    getPlantingVersion: build.query<
      PlantingVersionFeatureCollection,
      { id: string; version: number }
    >({
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
  useGetSpeciesQuery,
  useGetZonesQuery,
  useLazyGetPlantingVersionQuery,
} = projectResultApi;

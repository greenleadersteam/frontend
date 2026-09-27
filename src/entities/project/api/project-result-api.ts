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
// Возможность plantingEdits: правки посадок со статусами сервера.
export type EditedPlantingsFeatureCollection = Schemas['EditedPlantingsFeatureCollection'];
export type CheckedPlantingsFeatureCollection = Schemas['CheckedPlantingsFeatureCollection'];

const resultTag = (id: string) => [{ type: 'ProjectResult', id }] as const;
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
      providesTags: (_result, _error, id) => resultTag(id),
    }),
    getObstacles: build.query<ObstaclesFeatureCollection, string>({
      query: (id) => resultUrl(id, 'obstacles'),
      providesTags: (_result, _error, id) => resultTag(id),
    }),
    getRejected: build.query<RejectedSitesFeatureCollection, string>({
      query: (id) => resultUrl(id, 'rejected'),
      providesTags: (_result, _error, id) => resultTag(id),
    }),
    // 204 — правок не было: fetchBaseQuery отдаёт пустое тело как null.
    getPlantings: build.query<CheckedPlantingsFeatureCollection | null, string>({
      query: (id) => resultUrl(id, 'plantings'),
      providesTags: (_result, _error, id) => resultTag(id),
    }),
    // Ответ — те же посадки со статусами сервера: кэш GET обновляется им, без второго запроса.
    putPlantings: build.mutation<
      CheckedPlantingsFeatureCollection,
      { id: string; plantings: EditedPlantingsFeatureCollection }
    >({
      query: ({ id, plantings }) => ({
        url: resultUrl(id, 'plantings'),
        method: 'PUT',
        body: plantings,
      }),
      // Ошибку сохранения показывает вызывающий; отказ здесь только гасится, иначе он всплыл
      // бы необработанным.
      onQueryStarted: ({ id }, { dispatch, queryFulfilled }) =>
        queryFulfilled.then(
          ({ data }) =>
            void dispatch(projectResultApi.util.upsertQueryData('getPlantings', id, data)),
          () => undefined,
        ),
    }),
    // Справочники норм и пород общие для всех проектов.
    getNorms: build.query<Norm[], undefined>({ query: () => '/norms' }),
    getSpecies: build.query<Species[], undefined>({ query: () => '/species' }),
  }),
});

export const {
  useGetExplanationQuery,
  useGetNormsQuery,
  useGetObstaclesQuery,
  useGetPlantingQuery,
  useGetPlantingsQuery,
  useGetRejectedQuery,
  useGetSpeciesQuery,
  useGetZonesQuery,
  usePutPlantingsMutation,
} = projectResultApi;

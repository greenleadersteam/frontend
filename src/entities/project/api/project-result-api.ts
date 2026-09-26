import { baseApi, type ProposedApiComponents } from '@/shared/api';

type Schemas = ProposedApiComponents['schemas'];
export type Explanation = Schemas['Explanation'];
export type ZonesFeatureCollection = Schemas['ZonesFeatureCollection'];
export type PlantingFeatureCollection = Schemas['PlantingFeatureCollection'];

const resultTag = (id: string) => [{ type: 'ProjectResult', id }] as const;
const resultUrl = (id: string, resource: string) =>
  `/projects/${encodeURIComponent(id)}/${resource}`;

// Результат обработки проекта. Готов только в статусе ready: до этого бэкенд отвечает 404,
// различать его с «проекта нет» — через toResultError.
export const projectResultApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getExplanation: build.query<Explanation, string>({
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
  }),
});

export const { useGetExplanationQuery, useGetPlantingQuery, useGetZonesQuery } = projectResultApi;

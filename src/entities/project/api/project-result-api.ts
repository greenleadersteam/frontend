import { baseApi, type ProposedApiComponents } from '@/shared/api';

import type { PlantType } from '../model/project';

type Schemas = ProposedApiComponents['schemas'];
// В OpenAPI бэкенда у /explanation нет схемы ответа, а формат из контракта-предложения
// (нормы, проверки, отклонённые места) не реализован. Тип — по коду бэкенда
// (../backend/greenplan/explain/builder.py:17-32), задача P2-1. x и y — в метрах чертежа
// и при геопривязке (../backend/greenplan/api/jobs.py:329-330).
export type ExplanationEntry = {
  id: string;
  plant_type: PlantType;
  rule_id: string;
  rule_name_ru: string | null;
  x: number;
  y: number;
};
export type ZonesFeatureCollection = Schemas['ZonesFeatureCollection'];
export type PlantingFeatureCollection = Schemas['PlantingFeatureCollection'];

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
  }),
});

export const { useGetExplanationQuery, useGetPlantingQuery, useGetZonesQuery } = projectResultApi;

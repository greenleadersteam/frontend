import {
  type BaseQueryFn,
  createApi,
  type FetchArgs,
  fetchBaseQuery,
  type FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react';

import { getRuntimeConfig } from '@/shared/config';

// apiBaseUrl читается на каждом запросе, а не при импорте модуля: так baseApi не зависит
// от того, успел ли загрузиться runtime-конфиг к моменту создания store.
const baseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = (
  args,
  api,
  extraOptions,
) =>
  fetchBaseQuery({
    baseUrl: getRuntimeConfig().apiBaseUrl,
    headers: { Accept: 'application/json' },
  })(args, api, extraOptions);

// Нужен сущностям для типов результатов хуков RTK Query (TypedUseQueryHookResult).
export type AppBaseQuery = typeof baseQuery;

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery,
  tagTypes: ['Project', 'ProjectResult'],
  endpoints: () => ({}),
});

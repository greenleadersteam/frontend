import { type ApiComponents, baseApi, type ProposedApiComponents } from '@/shared/api';

import { type Project, type ProjectResponse, toProject } from '../model/project';

// По контракту-предложению bbox_user необязателен; задеплоенный бэкенд пока требует его (422).
type ProjectCreateRequest = ProposedApiComponents['schemas']['ProjectCreateRequest'];
type ProjectUpdateRequest = ApiComponents['schemas']['ProjectUpdateRequest'];
// Этих эндпоинтов у бэкенда ещё нет: типы из contracts/openapi.proposed.yaml.
type RunRequest = ProposedApiComponents['schemas']['RunRequest'];
type ProcessingDefaults = ProposedApiComponents['schemas']['ProcessingDefaults'];

const LIST = { type: 'Project', id: 'LIST' } as const;
const projectTag = (id: string) => ({ type: 'Project', id }) as const;
const projectUrl = (id: string) => `/projects/${encodeURIComponent(id)}`;

// Результат обработки меняется, когда проект доходит до ready — после загрузки или повтора.
// Сбрасывать его при запуске бесполезно: до ready бэкенд отвечает 404, а запись с ошибкой,
// у которой уже был успешный ответ, RTK Query новой подпиской не перезапрашивает.
const resultTagsOfNewlyReady = (before: Project[], after: Project[]) =>
  after
    .filter(
      (project) =>
        project.state.kind === 'ready' &&
        before.some(({ id, state }) => id === project.id && state.kind !== 'ready'),
    )
    .map(({ id }) => ({ type: 'ProjectResult', id }) as const);

// Ошибку запроса показывает подписчик; здесь нужен только успешный ответ.
const fulfilledData = <Data>(queryFulfilled: Promise<{ data: Data }>) =>
  queryFulfilled.then(
    ({ data }) => data,
    () => null,
  );

export const projectApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listProjects: build.query<Project[], undefined>({
      query: () => '/projects',
      transformResponse: (response: ProjectResponse[]) => response.map(toProject),
      providesTags: (projects = []) => [LIST, ...projects.map(({ id }) => projectTag(id))],
      async onQueryStarted(_arg, lifecycle) {
        const before = lifecycle.getCacheEntry().data ?? [];
        const after = await fulfilledData(lifecycle.queryFulfilled);
        if (after === null) return;
        const tags = resultTagsOfNewlyReady(before, after);
        if (tags.length > 0) lifecycle.dispatch(baseApi.util.invalidateTags(tags));
      },
    }),
    getProject: build.query<Project, string>({
      query: projectUrl,
      transformResponse: (response: ProjectResponse) => toProject(response),
      providesTags: (_project, _error, id) => [projectTag(id)],
      async onQueryStarted(_id, lifecycle) {
        const before = lifecycle.getCacheEntry().data;
        const after = await fulfilledData(lifecycle.queryFulfilled);
        if (after === null) return;
        const tags = resultTagsOfNewlyReady(before === undefined ? [] : [before], [after]);
        if (tags.length > 0) lifecycle.dispatch(baseApi.util.invalidateTags(tags));
      },
    }),
    createProject: build.mutation<Project, ProjectCreateRequest>({
      query: (body) => ({ url: '/projects', method: 'POST', body }),
      transformResponse: (response: ProjectResponse) => toProject(response),
      invalidatesTags: [LIST],
    }),
    updateProject: build.mutation<Project, { id: string; changes: ProjectUpdateRequest }>({
      query: ({ id, changes }) => ({ url: projectUrl(id), method: 'PATCH', body: changes }),
      transformResponse: (response: ProjectResponse) => toProject(response),
      invalidatesTags: (_project, _error, { id }) => [projectTag(id), LIST],
    }),
    deleteProject: build.mutation<null, string>({
      query: (id) => ({ url: projectUrl(id), method: 'DELETE' }),
      // Тег самого проекта не сбрасывается: иначе открытая страница перезапросит удалённый
      // проект и до перехода успеет показать 404.
      invalidatesTags: [LIST],
    }),
    runProject: build.mutation<Project, { id: string; request: RunRequest }>({
      query: ({ id, request }) => ({
        url: `${projectUrl(id)}/runs`,
        method: 'POST',
        body: request,
      }),
      transformResponse: (response: ProjectResponse) => toProject(response),
      invalidatesTags: (_project, _error, { id }) => [projectTag(id), LIST],
    }),
    getProcessingDefaults: build.query<ProcessingDefaults, undefined>({
      query: () => '/processing-defaults',
    }),
  }),
});

export const {
  useCreateProjectMutation,
  useDeleteProjectMutation,
  useGetProcessingDefaultsQuery,
  useGetProjectQuery,
  useLazyGetProjectQuery,
  useListProjectsQuery,
  useRunProjectMutation,
  useUpdateProjectMutation,
} = projectApi;

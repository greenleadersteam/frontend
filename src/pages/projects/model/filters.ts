import type { Project, ProjectState } from '@/entities/project';

export const STATE_GROUPS = ['all', 'ready', 'processing', 'failed', 'draft'] as const;
export type StateGroup = (typeof STATE_GROUPS)[number];

export const SORTS = ['updated', 'name', 'problems'] as const;
export type ProjectSort = (typeof SORTS)[number];

export type ProjectFilters = { query: string; state: StateGroup; sort: ProjectSort };

// Умолчания в адрес не пишутся: у списка без фильтров чистый URL.
export const DEFAULT_FILTERS: ProjectFilters = { query: '', state: 'all', sort: 'updated' };

const PARAM = { query: 'q', state: 'state', sort: 'sort' } as const;

const isStateGroup = (value: string | null): value is StateGroup =>
  STATE_GROUPS.some((group) => group === value);
const isSort = (value: string | null): value is ProjectSort => SORTS.some((sort) => sort === value);

// Параметры адреса — внешние данные: неизвестное значение — умолчание, а не ошибка.
export function readFilters(params: URLSearchParams): ProjectFilters {
  const state = params.get(PARAM.state);
  const sort = params.get(PARAM.sort);
  return {
    query: params.get(PARAM.query) ?? '',
    state: isStateGroup(state) ? state : DEFAULT_FILTERS.state,
    sort: isSort(sort) ? sort : DEFAULT_FILTERS.sort,
  };
}

export function writeFilters(params: URLSearchParams, filters: ProjectFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  // Поиск из одних пробелов — пустой; сам запрос хранится как введён, иначе поле съедало бы
  // пробел в конце набора.
  for (const key of ['query', 'state', 'sort'] as const) {
    const value = key === 'query' ? filters.query.trim() : filters[key];
    if (value === DEFAULT_FILTERS[key]) next.delete(PARAM[key]);
    else next.set(PARAM[key], filters[key]);
  }
  return next;
}

// Идущая обработка и неизвестный этап — одна группа: для пользователя это «ещё считается».
export function stateGroup(state: ProjectState): Exclude<StateGroup, 'all'> {
  switch (state.kind) {
    case 'ready':
      return 'ready';
    case 'failed':
      return 'failed';
    case 'draft':
      return 'draft';
    case 'processing':
    case 'unknown':
      return 'processing';
    default: {
      const unexpected: never = state;
      return unexpected;
    }
  }
}

export function stateCounts(projects: readonly Project[]): Record<StateGroup, number> {
  const counts: Record<StateGroup, number> = {
    all: projects.length,
    ready: 0,
    processing: 0,
    failed: 0,
    draft: 0,
  };
  for (const { state } of projects) counts[stateGroup(state)] += 1;
  return counts;
}

// Проблемные сверху: ошибка, затем проект без архива, затем идущая обработка, готовые — внизу.
const PROBLEM_ORDER: Record<Exclude<StateGroup, 'all'>, number> = {
  failed: 0,
  draft: 1,
  processing: 2,
  ready: 3,
};

const collator = new Intl.Collator('ru-RU', { numeric: true, sensitivity: 'base' });
// Поиск не различает регистр и «ё»/«е»: «Берёзовая» находится по «березовая».
const normalize = (text: string) => text.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
const byUpdated = (a: Project, b: Project) => Date.parse(b.updated_at) - Date.parse(a.updated_at);

export function visibleProjects(projects: readonly Project[], filters: ProjectFilters): Project[] {
  const query = normalize(filters.query.trim());
  const shown = projects.filter(
    (project) =>
      (filters.state === 'all' || stateGroup(project.state) === filters.state) &&
      normalize(project.name).includes(query),
  );
  switch (filters.sort) {
    case 'updated':
      return shown.sort(byUpdated);
    case 'name':
      return shown.sort((a, b) => collator.compare(a.name, b.name));
    case 'problems':
      return shown.sort(
        (a, b) =>
          PROBLEM_ORDER[stateGroup(a.state)] - PROBLEM_ORDER[stateGroup(b.state)] ||
          byUpdated(a, b),
      );
    default: {
      const unexpected: never = filters.sort;
      return unexpected;
    }
  }
}

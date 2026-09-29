import { describe, expect, test } from 'vitest';

import type { Project, ProjectState } from '@/entities/project';

import {
  DEFAULT_FILTERS,
  readFilters,
  stateCounts,
  visibleProjects,
  writeFilters,
} from './filters';

const project = (name: string, state: ProjectState, updatedAt: string): Project => ({
  id: name,
  name,
  description: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: updatedAt,
  state,
  job: { stage: 'x', progress_pct: 0 },
});

const LIST = [
  project('Сквер на Покровке', { kind: 'ready' }, '2026-09-20T10:00:00Z'),
  project('Берёзовая аллея', { kind: 'failed', error: null }, '2026-09-10T10:00:00Z'),
  project('Улица Бахрушина, 11', { kind: 'processing', stage: 'parsing' }, '2026-09-25T10:00:00Z'),
  project('Парк 2', { kind: 'draft' }, '2026-09-01T10:00:00Z'),
  project('Парк 10', { kind: 'unknown' }, '2026-08-01T10:00:00Z'),
];

const names = (projects: Project[]) => projects.map(({ name }) => name);

describe('фильтры списка проектов', () => {
  test('счётчики по группам: неизвестный этап — вместе с обработкой', () => {
    expect(stateCounts(LIST)).toEqual({ all: 5, ready: 1, processing: 2, failed: 1, draft: 1 });
  });

  test('по умолчанию — все, сначала изменённые недавно', () => {
    expect(names(visibleProjects(LIST, DEFAULT_FILTERS))).toEqual([
      'Улица Бахрушина, 11',
      'Сквер на Покровке',
      'Берёзовая аллея',
      'Парк 2',
      'Парк 10',
    ]);
  });

  test('поиск по названию — без учёта регистра и «ё»', () => {
    expect(names(visibleProjects(LIST, { ...DEFAULT_FILTERS, query: ' БЕРЕЗОВАЯ ' }))).toEqual([
      'Берёзовая аллея',
    ]);
  });

  test('группа и поиск вместе', () => {
    expect(
      names(visibleProjects(LIST, { ...DEFAULT_FILTERS, state: 'processing', query: 'парк' })),
    ).toEqual(['Парк 10']);
  });

  test('по названию — числа по значению', () => {
    expect(names(visibleProjects(LIST, { ...DEFAULT_FILTERS, sort: 'name' }))).toEqual([
      'Берёзовая аллея',
      'Парк 2',
      'Парк 10',
      'Сквер на Покровке',
      'Улица Бахрушина, 11',
    ]);
  });

  test('сначала проблемные: ошибка, без архива, обработка, готовые', () => {
    expect(names(visibleProjects(LIST, { ...DEFAULT_FILTERS, sort: 'problems' }))).toEqual([
      'Берёзовая аллея',
      'Парк 2',
      'Улица Бахрушина, 11',
      'Парк 10',
      'Сквер на Покровке',
    ]);
  });
});

describe('фильтры в адресе', () => {
  test('чтение: неизвестные значения — умолчания', () => {
    expect(readFilters(new URLSearchParams('q=сквер&state=failed&sort=name'))).toEqual({
      query: 'сквер',
      state: 'failed',
      sort: 'name',
    });
    expect(readFilters(new URLSearchParams('state=deleted&sort=rms'))).toEqual(DEFAULT_FILTERS);
  });

  test('запись: умолчания и пустой поиск не пишутся, чужие параметры остаются', () => {
    const params = writeFilters(new URLSearchParams('data=demo&q=старый'), {
      query: '  ',
      state: 'ready',
      sort: 'updated',
    });

    expect(params.toString()).toBe('data=demo&state=ready');
  });
});

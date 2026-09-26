import { describe, expect, test } from 'vitest';

import type { Project, ProjectState } from '@/entities/project';

import { deleteAvailability } from './delete-availability';

const STARTED_AT = '2026-09-20T10:00:00Z';
const started = Date.parse(STARTED_AT);
const minutes = (count: number) => count * 60 * 1000;

const project = (state: ProjectState): Project => ({
  id: 'p',
  name: 'Сквер',
  description: null,
  created_at: STARTED_AT,
  updated_at: STARTED_AT,
  state,
  job: { stage: 'x', progress_pct: 0, started_at: STARTED_AT },
});

const zoning = project({ kind: 'processing', stage: 'zoning_layout' });
const queued = project({ kind: 'processing', stage: 'queued' });

// Одна функция для списка и экрана проекта: условия там и там совпадают.
describe('deleteAvailability', () => {
  test.each<ProjectState>([{ kind: 'draft' }, { kind: 'ready' }, { kind: 'failed', error: null }])(
    '%o — удаление доступно без предупреждения',
    (state) => {
      expect(deleteAvailability(project(state), { stalled: false, checkedAt: started })).toEqual({
        locked: false,
        hang: null,
      });
    },
  );

  test('идёт обработка — удаление закрыто', () => {
    expect(
      deleteAvailability(zoning, { stalled: false, checkedAt: started + minutes(45) }),
    ).toEqual({ locked: true });
  });

  test('предохранитель сработал, но обработка моложе 30 минут — закрыто', () => {
    expect(deleteAvailability(zoning, { stalled: true, checkedAt: started + minutes(29) })).toEqual(
      { locked: true },
    );
  });

  test.each([
    [zoning, 'processing'],
    [queued, 'queued'],
    [project({ kind: 'unknown' }), 'processing'],
  ] as const)('зависла дольше 30 минут — открыто, этап %#: %s', (target, hang) => {
    expect(deleteAvailability(target, { stalled: true, checkedAt: started + minutes(30) })).toEqual(
      { locked: false, hang },
    );
  });
});

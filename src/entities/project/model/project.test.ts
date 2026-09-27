import { describe, expect, test } from 'vitest';

import {
  getProcessingDurationMs,
  isProcessing,
  type Job,
  type JobError,
  parseProjectState,
  toProject,
} from './project';

const job = (fields: Partial<Job> = {}): Job => ({ stage: 'draft', progress_pct: 0, ...fields });

describe('parseProjectState', () => {
  test.each(['queued', 'extracting', 'parsing', 'georeferencing', 'zoning_layout', 'exporting'])(
    '%s — обработка идёт, этап сохранён',
    (status) => {
      expect(parseProjectState(status, job({ stage: status }))).toEqual({
        kind: 'processing',
        stage: status,
      });
    },
  );

  test('draft и ready', () => {
    expect(parseProjectState('draft', job())).toEqual({ kind: 'draft' });
    expect(parseProjectState('ready', job({ stage: 'ready' }))).toEqual({ kind: 'ready' });
  });

  test('failed несёт ошибку обработки', () => {
    const error: JobError = { code: 'ambiguous_root_dxf', message: 'x', candidates: ['a.dxf'] };

    expect(parseProjectState('failed', job({ stage: 'failed', error }))).toEqual({
      kind: 'failed',
      error,
    });
  });

  test('failed без ошибки в ответе', () => {
    expect(parseProjectState('failed', job({ stage: 'failed' }))).toEqual({
      kind: 'failed',
      error: null,
    });
  });

  test.each(['postprocessing', '', 'READY', 'toString'])('«%s» — неизвестный статус', (status) => {
    expect(parseProjectState(status, job())).toEqual({ kind: 'unknown' });
  });
});

test('toProject заменяет строку status разобранным состоянием', () => {
  const project = toProject({
    id: 'p1',
    name: 'Сквер',
    description: null,
    created_at: '2026-09-20T10:00:00Z',
    updated_at: '2026-09-20T10:00:00Z',
    status: 'parsing',
    job: job({ stage: 'parsing', progress_pct: 10 }),
  });

  expect(project).not.toHaveProperty('status');
  expect(project.state).toEqual({ kind: 'processing', stage: 'parsing' });
  expect(project.job.progress_pct).toBe(10);
});

test.each([
  [{ kind: 'draft' } as const, false],
  [{ kind: 'processing', stage: 'queued' } as const, true],
  [{ kind: 'unknown' } as const, true],
  [{ kind: 'ready' } as const, false],
  [{ kind: 'failed', error: null } as const, false],
])('isProcessing(%o) — %s', (state, expected) => {
  expect(isProcessing(state)).toBe(expected);
});

describe('getProcessingDurationMs', () => {
  test('разница finished_at и started_at', () => {
    expect(
      getProcessingDurationMs(
        job({ started_at: '2026-09-20T10:00:01Z', finished_at: '2026-09-20T10:01:13.5Z' }),
      ),
    ).toBe(72_500);
  });

  test('обработка не завершена — длительности нет', () => {
    expect(getProcessingDurationMs(job({ started_at: '2026-09-20T10:00:01Z' }))).toBeNull();
    expect(getProcessingDurationMs(job())).toBeNull();
  });
});

import { act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { renderHookWithStore, resetMockDb, server } from '@/shared/lib/test';

import {
  POLLING_INTERVAL_MS,
  POLLING_LIMIT_MS,
  useProjectsWithPolling,
  useProjectWithPolling,
} from './polling';

const PROCESSING_ID = '3f7b1d9c5e2a4b8d6f0c3e5a7b9d1f2c';
const DRAFT_ID = '9a1c3e5b7d2f4a6c8e0b2d4f6a8c1e3b';
const SCRIPTED_ID = 'scripted';

const countRequests = (path: string) => {
  const counter = { count: 0 };
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'GET' && new URL(request.url).pathname === path) counter.count += 1;
  });
  return counter;
};

// Проект, статус которого на каждый запрос задаёт тест.
const serveProject = (id: string, nextStatus: () => string) => {
  server.use(
    http.get(`/api/projects/${id}`, () => {
      const status = nextStatus();
      return HttpResponse.json({
        id,
        name: 'Сквер',
        description: null,
        created_at: '2026-09-20T10:00:00Z',
        updated_at: '2026-09-20T10:00:00Z',
        status,
        job: { stage: status, progress_pct: 10 },
      });
    }),
  );
};

// Статусы по очереди; последний повторяется.
const serveStatuses = (statuses: string[]) => {
  let index = 0;
  serveProject(SCRIPTED_ID, () => {
    const status = statuses[Math.min(index, statuses.length - 1)] ?? 'draft';
    index += 1;
    return status;
  });
};

const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

// Ответ MSW приходит на настоящих тиках, поэтому первую загрузку ждём, а не проматываем.
const loaded = (read: () => unknown) =>
  act(() =>
    vi.waitFor(() => {
      expect(read()).toBeDefined();
    }),
  );

beforeEach(() => {
  // setImmediate и queueMicrotask остаются настоящими: на них держится fetch в Node и MSW.
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  resetMockDb();
});

afterEach(() => {
  server.events.removeAllListeners();
  vi.useRealTimers();
});

describe('useProjectWithPolling', () => {
  test('опрашивает, пока идёт обработка, и останавливается на ready', async () => {
    const requests = countRequests(`/api/projects/${PROCESSING_ID}`);
    const { result } = renderHookWithStore(() => useProjectWithPolling(PROCESSING_ID));

    await loaded(() => result.current.data);
    expect(result.current.data?.state.kind).toBe('processing');
    await wait(20_000);
    expect(result.current.data?.state).toEqual({ kind: 'ready' });

    const afterReady = requests.count;
    expect(afterReady).toBeGreaterThan(5);
    await wait(10 * POLLING_INTERVAL_MS);
    expect(requests.count).toBe(afterReady);
  });

  test('останавливается на failed', async () => {
    serveStatuses(['parsing', 'zoning_layout', 'failed']);
    const requests = countRequests(`/api/projects/${SCRIPTED_ID}`);
    const { result } = renderHookWithStore(() => useProjectWithPolling(SCRIPTED_ID));

    await wait(5 * POLLING_INTERVAL_MS);

    expect(result.current.data?.state.kind).toBe('failed');
    expect(requests.count).toBe(3);
  });

  test('не опрашивает проект без архива', async () => {
    const requests = countRequests(`/api/projects/${DRAFT_ID}`);
    const { result } = renderHookWithStore(() => useProjectWithPolling(DRAFT_ID));

    await wait(10 * POLLING_INTERVAL_MS);

    expect(result.current.data?.state).toEqual({ kind: 'draft' });
    expect(requests.count).toBe(1);
  });

  test('неизвестный статус не прекращает опрос', async () => {
    serveStatuses(['postprocessing', 'postprocessing', 'ready']);
    const requests = countRequests(`/api/projects/${SCRIPTED_ID}`);
    const { result } = renderHookWithStore(() => useProjectWithPolling(SCRIPTED_ID));

    await wait(5 * POLLING_INTERVAL_MS);

    expect(result.current.data?.state).toEqual({ kind: 'ready' });
    expect(requests.count).toBe(3);
  });

  test('через 30 минут опрос останавливается, «Проверить снова» возобновляет его', async () => {
    serveStatuses(['parsing']);
    const requests = countRequests(`/api/projects/${SCRIPTED_ID}`);
    const { result } = renderHookWithStore(() => useProjectWithPolling(SCRIPTED_ID));

    await loaded(() => result.current.data);
    await wait(POLLING_LIMIT_MS);
    expect(result.current.pollingStalled).toBe(true);
    const afterLimit = requests.count;
    await wait(10 * POLLING_INTERVAL_MS);
    expect(requests.count).toBe(afterLimit);

    act(() => {
      result.current.checkAgain();
    });
    await wait(3 * POLLING_INTERVAL_MS);
    expect(result.current.pollingStalled).toBe(false);
    expect(requests.count).toBe(afterLimit + 4);
  });

  test('новая обработка после завершения прошлой начинает отсчёт заново', async () => {
    let status = 'parsing';
    serveProject(SCRIPTED_ID, () => status);
    const requests = countRequests(`/api/projects/${SCRIPTED_ID}`);
    const { result } = renderHookWithStore(() => useProjectWithPolling(SCRIPTED_ID));

    await loaded(() => result.current.data);
    await wait(POLLING_LIMIT_MS);
    // Завершение видно без «Проверить снова» — например, при возврате фокуса.
    status = 'ready';
    act(() => {
      void result.current.refetch();
    });
    await wait(POLLING_INTERVAL_MS);
    expect(result.current.data?.state).toEqual({ kind: 'ready' });

    status = 'queued';
    act(() => {
      void result.current.refetch();
    });
    await wait(POLLING_INTERVAL_MS);
    const afterRestart = requests.count;
    await wait(3 * POLLING_INTERVAL_MS);

    expect(result.current.pollingStalled).toBe(false);
    expect(requests.count).toBe(afterRestart + 3);
  });

  test('другой проект в том же компоненте не наследует остановленный опрос', async () => {
    serveProject('first', () => 'parsing');
    serveProject('second', () => 'parsing');
    let id = 'second';
    const { result, rerender } = renderHookWithStore(() => useProjectWithPolling(id));
    await loaded(() => result.current.data);

    id = 'first';
    rerender();
    await loaded(() => result.current.data);
    await wait(POLLING_LIMIT_MS);
    expect(result.current.pollingStalled).toBe(true);

    id = 'second';
    rerender();
    expect(result.current.pollingStalled).toBe(false);
  });

  test('другой проект в том же компоненте начинает свой отсчёт, а не доедает чужой', async () => {
    serveProject('first', () => 'parsing');
    serveProject('second', () => 'parsing');
    let id = 'second';
    const { result, rerender } = renderHookWithStore(() => useProjectWithPolling(id));
    await loaded(() => result.current.data);

    id = 'first';
    rerender();
    await loaded(() => result.current.data);
    await wait(POLLING_LIMIT_MS - 60_000);

    id = 'second';
    rerender();
    await wait(120_000);
    expect(result.current.pollingStalled).toBe(false);
  });
});

test('проект удалён во время опроса — «не найден», опрос останавливается', async () => {
  const requests = countRequests(`/api/projects/${PROCESSING_ID}`);
  const { result } = renderHookWithStore(() => useProjectWithPolling(PROCESSING_ID));
  await loaded(() => result.current.data);
  expect(result.current.notFound).toBe(false);

  await act(async () => {
    await fetch(`/api/projects/${PROCESSING_ID}`, { method: 'DELETE' });
  });
  await wait(POLLING_INTERVAL_MS);
  await act(() =>
    vi.waitFor(() => {
      expect(result.current.notFound).toBe(true);
    }),
  );

  const afterNotFound = requests.count;
  await wait(10 * POLLING_INTERVAL_MS);
  expect(requests.count).toBe(afterNotFound);
});

describe('useProjectsWithPolling', () => {
  test('опрашивает список одним запросом, пока в нём есть идущие обработки', async () => {
    const listRequests = countRequests('/api/projects');
    const { result } = renderHookWithStore(() => useProjectsWithPolling());

    await loaded(() => result.current.data);
    expect(result.current.data?.some(({ state }) => state.kind === 'processing')).toBe(true);
    await wait(20_000);
    expect(result.current.data?.some(({ state }) => state.kind === 'processing')).toBe(false);

    const afterDone = listRequests.count;
    expect(afterDone).toBeGreaterThan(5);
    await wait(10 * POLLING_INTERVAL_MS);
    expect(listRequests.count).toBe(afterDone);
  });
});

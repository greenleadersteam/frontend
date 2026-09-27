import { act } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { renderHookWithStore, resetMockDb } from '@/shared/lib/test';

import { POLLING_INTERVAL_MS, useProjectWithPolling } from '../model/polling';
import { useRunProjectMutation } from './project-api';
import { useGetExplanationQuery } from './project-result-api';

const READY_ID = '5c0b7f2e9a3d4e61b8f0c2a7d9e4b1f3';

const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  // setImmediate и queueMicrotask остаются настоящими: на них держится fetch в Node и MSW.
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  resetMockDb();
});

afterEach(() => {
  vi.useRealTimers();
});

test('после повторной обработки результат перезапрашивается, когда проект снова готов', async () => {
  const { result } = renderHookWithStore(() => ({
    project: useProjectWithPolling(READY_ID),
    explanation: useGetExplanationQuery(READY_ID),
    run: useRunProjectMutation(),
  }));
  await act(() =>
    vi.waitFor(() => {
      expect(result.current.explanation.data).toBeDefined();
    }),
  );
  expect(result.current.explanation.data?.some((p) => p.plant_type === 'shrub')).toBe(true);

  await act(async () => {
    const [runProject] = result.current.run;
    await runProject({ id: READY_ID, request: { plant_types: ['tree'] } });
  });
  for (let step = 0; step < 12; step += 1) await wait(POLLING_INTERVAL_MS);

  expect(result.current.project.data?.state).toEqual({ kind: 'ready' });
  expect(result.current.explanation.isError).toBe(false);
  expect(result.current.explanation.data?.every(({ plant_type }) => plant_type === 'tree')).toBe(
    true,
  );
});

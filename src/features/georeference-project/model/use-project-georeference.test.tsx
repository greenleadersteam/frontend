import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { ManualGeoreference, Project } from '@/entities/project';
import type * as Config from '@/shared/config';
import { renderHookWithStore, server } from '@/shared/lib/test';

import { readStoredRaw, removeStored, writeStored } from './stored';
import { useApplyGeoreference, useBrowserGeoreference } from './use-project-georeference';

const capability = vi.hoisted(() => ({ manualGeoreference: false }));
vi.mock('@/shared/config', async (importOriginal) => {
  const actual = await importOriginal<typeof Config>();
  return {
    ...actual,
    useCapability: (name: Config.Capability) =>
      name === 'manualGeoreference' ? capability.manualGeoreference : actual.useCapability(name),
  };
});

// «Улица Шаболовка, 37» из моков: готова, без геопривязки.
const PROJECT: Project = {
  id: '0e8d2b6a4c1f47e9a3b5d7c9e1f2a4b6',
  name: 'Улица Шаболовка, 37',
  description: null,
  created_at: '2026-09-19T10:00:00Z',
  updated_at: '2026-09-19T10:00:00Z',
  state: { kind: 'ready' },
  job: { stage: 'ready', progress_pct: 100, finished_at: '2026-09-26T10:00:20Z' },
};

const GEOREFERENCE: ManualGeoreference = {
  anchor_wgs84: { lat: 55.72, lon: 37.61 },
  anchor_drawing: { x: 30, y: 8.5 },
  rotation_deg: -4,
  scale: 1,
  method: 'manual',
  rms_m: null,
  control_points: [],
};

beforeEach(() => {
  capability.manualGeoreference = false;
});

afterEach(() => {
  removeStored(PROJECT.id);
  server.events.removeAllListeners();
});

describe('применение привязки к проекту', () => {
  test('без manualGeoreference — в браузер, запросов нет; экран проекта видит её сразу', async () => {
    const requests: string[] = [];
    server.events.on('request:start', ({ request }) => {
      requests.push(`${request.method} ${new URL(request.url).pathname}`);
    });
    const { result } = renderHookWithStore(() => ({
      applied: useApplyGeoreference(),
      stored: useBrowserGeoreference(PROJECT),
    }));
    expect(result.current.stored).toEqual({ kind: 'none' });

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.applied.apply(PROJECT, GEOREFERENCE);
    });

    expect(outcome).toEqual({ kind: 'browser' });
    expect(result.current.stored).toEqual({ kind: 'current', georeference: GEOREFERENCE });
    expect(requests).toEqual([]);
  });

  test('с manualGeoreference — PUT /georeference, проект снова в обработке, запись браузера убрана', async () => {
    capability.manualGeoreference = true;
    writeStored(PROJECT.id, PROJECT.job.finished_at ?? null, GEOREFERENCE);
    let body: unknown = null;
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'PUT')
        void request
          .clone()
          .json()
          .then((json: unknown) => (body = json));
    });
    const { result } = renderHookWithStore(() => useApplyGeoreference());

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.apply(PROJECT, GEOREFERENCE);
    });

    expect(outcome).toEqual({ kind: 'server' });
    expect(body).toEqual(GEOREFERENCE);
    expect(readStoredRaw(PROJECT.id)).toBeNull();
  });

  test('проект с геопривязкой сервера запись браузера не читает', () => {
    writeStored(PROJECT.id, PROJECT.job.finished_at ?? null, GEOREFERENCE);
    const georeferenced: Project = {
      ...PROJECT,
      job: {
        ...PROJECT.job,
        georeference: { confidence: 'validated', matched_labels: [], residuals_m: {} },
      },
    };

    const { result } = renderHookWithStore(() => useBrowserGeoreference(georeferenced));

    expect(result.current).toEqual({ kind: 'none' });
  });
});

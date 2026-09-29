import { act, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type { PlantingVersionFeatureCollection, Project } from '@/entities/project';
import { baseApi } from '@/shared/api';
import type * as Config from '@/shared/config';
import { useAppDispatch, useAppSelector } from '@/shared/lib/store';
import { renderHookWithStore, resetMockDb } from '@/shared/lib/test';

import { plantingEditsSlice, selectProjectEdits } from './edits';
import { useEditsLoader } from './use-planting-edits';

vi.mock('@/shared/config', async (importOriginal) => {
  const actual = await importOriginal<typeof Config>();
  return {
    ...actual,
    useCapability: (name: Config.Capability) =>
      name === 'plantingEdits' ? true : actual.useCapability(name),
  };
});

// «Сквер на Покровке» из моков: готов, с геопривязкой.
const ID = '5c0b7f2e9a3d4e61b8f0c2a7d9e4b1f3';
const project = (finishedAt: string): Project => ({
  id: ID,
  name: 'Сквер на Покровке',
  description: null,
  created_at: '2026-09-19T10:00:00Z',
  updated_at: '2026-09-19T10:00:00Z',
  state: { kind: 'ready' },
  job: { stage: 'ready', progress_pct: 100, finished_at: finishedAt },
});

const readJson = async (response: Response): Promise<PlantingVersionFeatureCollection> => {
  // Тип тела — по контракту: runtime-проверки ответов нет, как и в продуктовом коде.
  const body: unknown = await response.json();
  return body as PlantingVersionFeatureCollection;
};

describe('useEditsLoader с версиями плана посадок', () => {
  test('новая обработка начинает историю заново: открывается её версия, а не прежняя', async () => {
    const service = await readJson(await fetch(`/api/projects/${ID}/plantings/1`));
    const [first] = service.features;
    if (first === undefined) throw new Error('нет посадок');
    await fetch(`/api/projects/${ID}/plantings/1/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ add: [], update: [], delete: [first.properties.id] }),
    });

    let finishedAt = '2026-09-26T10:00:00Z';
    const { result, rerender } = renderHookWithStore(
      () => {
        useEditsLoader(project(finishedAt), service);
        return {
          dispatch: useAppDispatch(),
          entry: useAppSelector((state) => selectProjectEdits(state, ID)),
        };
      },
      { [plantingEditsSlice.name]: plantingEditsSlice.reducer },
    );
    await waitFor(() => {
      expect(result.current.entry?.version).toBe(2);
    });
    expect(result.current.entry?.present.removed).toEqual({ [first.properties.id]: true });

    // Проект обработан заново: в моке истории больше нет, результат сброшен тегом, как при ready.
    resetMockDb();
    finishedAt = '2026-09-28T10:00:00Z';
    act(() => {
      result.current.dispatch(baseApi.util.invalidateTags([{ type: 'ProjectResult', id: ID }]));
    });
    rerender();

    await waitFor(() => {
      expect(result.current.entry?.version).toBe(1);
    });
    expect(result.current.entry?.present.removed).toEqual({});
    expect(result.current.entry?.finishedAt).toBe(finishedAt);
  });

  test('та же версия 1 после новой обработки открывается заново, без прежних правок', async () => {
    const service = await readJson(await fetch(`/api/projects/${ID}/plantings/1`));
    let finishedAt = '2026-09-26T10:00:00Z';
    const { result, rerender } = renderHookWithStore(
      () => {
        useEditsLoader(project(finishedAt), service);
        return {
          dispatch: useAppDispatch(),
          entry: useAppSelector((state) => selectProjectEdits(state, ID)),
        };
      },
      { [plantingEditsSlice.name]: plantingEditsSlice.reducer },
    );
    await waitFor(() => {
      expect(result.current.entry?.version).toBe(1);
    });
    act(() => {
      result.current.dispatch(
        plantingEditsSlice.actions.removed({ projectId: ID, id: 'TREE_ROW_CURB-00001' }),
      );
    });
    expect(result.current.entry?.present.removed).toEqual({ 'TREE_ROW_CURB-00001': true });

    finishedAt = '2026-09-28T10:00:00Z';
    rerender();

    await waitFor(() => {
      expect(result.current.entry?.finishedAt).toBe(finishedAt);
    });
    expect(result.current.entry?.present.removed).toEqual({});
  });
});

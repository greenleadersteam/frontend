import { describe, expect, test } from 'vitest';

import {
  estimateRemainingSeconds,
  initialWizardState,
  type UploadState,
  wizardReducer,
  type WizardState,
} from './wizard';

const archive = { file: new File(['x'], 'site.zip'), packed: false, entries: [] };

describe('wizardReducer', () => {
  test('новый проект начинается с описания, существующий — с архива', () => {
    expect(initialWizardState(null).step).toBe('details');
    const project = { id: 'p1', name: 'Сквер', keepOnLeave: true };
    expect(initialWizardState({ project, start: 'archive' }).step).toBe('archive');
    expect(initialWizardState({ project, start: 'root-choice' })).toMatchObject({
      step: 'processing',
      upload: { kind: 'accepted', acceptedAt: 0 },
    });
  });

  test('созданный мастером проект удаляется при уходе, пока архив не принят', () => {
    let state = wizardReducer(initialWizardState(null), { type: 'uploadRequested' });
    state = wizardReducer(state, { type: 'projectCreated', id: 'p1', name: 'Сквер' });
    expect(state.project?.keepOnLeave).toBe(false);

    state = wizardReducer(state, { type: 'uploadAccepted', at: 0 });
    expect(state.project?.keepOnLeave).toBe(true);
    // Возврат к архиву после ошибки обработки проект уже не делает удаляемым.
    state = wizardReducer(state, { type: 'returnedToArchive', notice: null });
    expect(state.project?.keepOnLeave).toBe(true);
    expect(state.step).toBe('archive');
  });

  test('отмена возвращает на шаг «Файлы» с тем же файлом', () => {
    const base: WizardState = {
      ...initialWizardState(null),
      step: 'processing',
      archive,
      project: { id: 'p1', name: 'Сквер', keepOnLeave: false },
      upload: { kind: 'uploading', sentBytes: 10, totalBytes: 100, samples: [] },
    };

    const cancelled = wizardReducer(base, { type: 'uploadCancelled', projectDeleted: true });

    expect(cancelled).toMatchObject({
      step: 'archive',
      archive,
      project: null,
      upload: { kind: 'idle' },
    });
  });

  test('отказ сервера возвращает к архиву с сообщением и без прежнего файла', () => {
    const state = wizardReducer(
      { ...initialWizardState(null), step: 'processing', archive },
      { type: 'returnedToArchive', notice: 'Архив больше 100 МБ.' },
    );

    expect(state).toMatchObject({
      step: 'archive',
      archive: null,
      archiveNotice: 'Архив больше 100 МБ.',
    });
  });

  test('прогресс хранит точки только за последние 5 с', () => {
    let state = initialWizardState(null);
    for (const at of [0, 2000, 4000, 6000]) {
      state = wizardReducer(state, {
        type: 'uploadProgressed',
        sentBytes: at,
        totalBytes: 10_000,
        at,
      });
    }

    expect(state.upload.kind === 'uploading' && state.upload.samples.map(({ at }) => at)).toEqual([
      2000, 4000, 6000,
    ]);
  });
});

describe('estimateRemainingSeconds', () => {
  const uploading = (samples: [number, number][], totalBytes: number): UploadState => ({
    kind: 'uploading',
    sentBytes: samples.at(-1)?.[1] ?? 0,
    totalBytes,
    samples: samples.map(([at, sentBytes]) => ({ at, sentBytes })),
  });

  test('скорость по окну: 1 МБ/с, осталось 40 МБ — 40 с', () => {
    const mb = 2 ** 20;
    expect(
      estimateRemainingSeconds(
        uploading(
          [
            [0, 10 * mb],
            [1000, 11 * mb],
            [2000, 12 * mb],
          ],
          52 * mb,
        ),
      ),
    ).toBe(40);
  });

  test('пока данных мало — оценки нет', () => {
    expect(
      estimateRemainingSeconds(
        uploading(
          [
            [0, 0],
            [1000, 10],
          ],
          100,
        ),
      ),
    ).toBeNull();
    expect(
      estimateRemainingSeconds(
        uploading(
          [
            [0, 0],
            [500, 10],
            [1000, 20],
          ],
          100,
        ),
      ),
    ).toBeNull();
    expect(estimateRemainingSeconds({ kind: 'creating' })).toBeNull();
  });

  test('без движения — оценки нет', () => {
    expect(
      estimateRemainingSeconds(
        uploading(
          [
            [0, 5],
            [1000, 5],
            [2000, 5],
          ],
          100,
        ),
      ),
    ).toBeNull();
  });
});

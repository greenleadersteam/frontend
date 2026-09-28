import { afterEach, describe, expect, test, vi } from 'vitest';

import type { ManualGeoreference } from '@/entities/project';

import { parseStored, readStoredRaw, removeStored, subscribeStored, writeStored } from './stored';

const P = 'project-1';
const GEOREFERENCE: ManualGeoreference = {
  anchor_wgs84: { lat: 55.75, lon: 37.62 },
  anchor_drawing: { x: 30, y: 8.5 },
  rotation_deg: 12.5,
  scale: 1,
  method: 'manual',
  rms_m: null,
  control_points: [],
};

afterEach(() => {
  removeStored(P);
  vi.restoreAllMocks();
});

describe('привязка проекта в браузере', () => {
  test('записана и прочитана для той же обработки', () => {
    expect(writeStored(P, '2026-09-20T10:00:00Z', GEOREFERENCE)).toBe(true);

    expect(parseStored(readStoredRaw(P), '2026-09-20T10:00:00Z')).toEqual({
      kind: 'current',
      georeference: GEOREFERENCE,
    });
  });

  test('проект обработан заново — привязка устарела', () => {
    writeStored(P, '2026-09-20T10:00:00Z', GEOREFERENCE);

    expect(parseStored(readStoredRaw(P), '2026-09-27T12:00:00Z')).toEqual({
      kind: 'stale',
      georeference: GEOREFERENCE,
    });
  });

  test('записи нет, она не JSON или не по форме — привязки нет', () => {
    expect(parseStored(readStoredRaw(P), null)).toEqual({ kind: 'none' });
    expect(parseStored('{', null)).toEqual({ kind: 'none' });
    expect(
      parseStored(
        JSON.stringify({ finishedAt: null, georeference: { ...GEOREFERENCE, scale: 0 } }),
        null,
      ),
    ).toEqual({ kind: 'none' });
  });

  test('запись и удаление сообщают подписчикам; удалённой привязки нет', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeStored(listener);
    writeStored(P, null, GEOREFERENCE);
    removeStored(P);
    unsubscribe();
    writeStored(P, null, GEOREFERENCE);

    expect(listener).toHaveBeenCalledTimes(2);
    removeStored(P);
    expect(readStoredRaw(P)).toBeNull();
  });

  test('браузер не даёт хранить данные — записать нельзя, прочитать — пусто', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });

    expect(writeStored(P, null, GEOREFERENCE)).toBe(false);
    expect(readStoredRaw(P)).toBeNull();
  });
});

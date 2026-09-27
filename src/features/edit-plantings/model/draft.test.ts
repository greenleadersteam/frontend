import { afterEach, describe, expect, test, vi } from 'vitest';

import { readDraft, removeDraft, writeDraft } from './draft';
import { emptyDiff } from './edits';

const P = 'project-1';
const diff = { ...emptyDiff(), moved: { 'T-1': [1, 2] as [number, number] } };

afterEach(() => {
  removeDraft(P);
  vi.restoreAllMocks();
});

describe('черновик правок в браузере', () => {
  test('записан и прочитан для той же обработки', () => {
    expect(writeDraft(P, '2026-09-20T10:00:00Z', diff)).toBe(true);

    expect(readDraft(P, '2026-09-20T10:00:00Z')).toEqual({ kind: 'current', diff });
  });

  test('проект переобработан — черновик устарел', () => {
    writeDraft(P, '2026-09-20T10:00:00Z', diff);

    expect(readDraft(P, '2026-09-27T12:00:00Z')).toEqual({ kind: 'stale', diff });
  });

  test('черновика нет или он повреждён — как будто нет', () => {
    expect(readDraft(P, null)).toEqual({ kind: 'none' });

    // eslint-disable-next-line no-restricted-globals -- тест кладёт повреждённый черновик напрямую
    localStorage.setItem(
      `greenleaders:planting-edits:${P}`,
      '{"finishedAt":null,"diff":{"moved":1}}',
    );
    expect(readDraft(P, null)).toEqual({ kind: 'none' });

    // eslint-disable-next-line no-restricted-globals -- тест кладёт повреждённый черновик напрямую
    localStorage.setItem(`greenleaders:planting-edits:${P}`, 'не JSON');
    expect(readDraft(P, null)).toEqual({ kind: 'none' });
  });

  test('хранилище недоступно — правки живут в памяти, с пояснением', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    expect(readDraft(P, null)).toEqual({ kind: 'unavailable' });
    expect(writeDraft(P, null, diff)).toBe(false);
  });
});

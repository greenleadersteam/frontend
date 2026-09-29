import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { useBasemapChoice } from './basemap-choice';

const IMAGERY = {
  tilesUrl: 'https://tiles.example.org/imagery/{z}/{y}/{x}',
  labelsUrl: 'https://tiles.example.org/labels/{z}/{y}/{x}',
  attribution: 'Источник',
};
const KEY = 'greenleaders.basemap';
// eslint-disable-next-line no-restricted-properties -- выбор подложки лежит в хранилище сеанса: тест его читает и чистит
const storage = window.sessionStorage;

afterEach(() => {
  storage.clear();
  vi.restoreAllMocks();
});

describe('выбор подложки', () => {
  test('по умолчанию — «Схема»', () => {
    const { result } = renderHook(() => useBasemapChoice(IMAGERY));

    expect(result.current.kind).toBe('scheme');
  });

  test('выбор запоминается до конца сеанса и достаётся следующей карте', () => {
    const first = renderHook(() => useBasemapChoice(IMAGERY));
    act(() => {
      first.result.current.choose('imagery-labels');
    });

    expect(first.result.current.kind).toBe('imagery-labels');
    expect(storage.getItem(KEY)).toBe('imagery-labels');
    expect(renderHook(() => useBasemapChoice(IMAGERY)).result.current.kind).toBe('imagery-labels');
  });

  test('запомненный снимок без imagery в конфиге — «Схема»', () => {
    storage.setItem(KEY, 'imagery');

    const { result } = renderHook(() => useBasemapChoice(null));

    expect(result.current.kind).toBe('scheme');
    expect(result.current.options.map(({ kind }) => kind)).toEqual(['scheme', 'light']);
  });

  test('чужое значение в хранилище не принимается', () => {
    storage.setItem(KEY, 'yandex');

    expect(renderHook(() => useBasemapChoice(IMAGERY)).result.current.kind).toBe('scheme');
  });

  test('хранилище недоступно — выбор работает до перезагрузки', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const { result } = renderHook(() => useBasemapChoice(IMAGERY));

    act(() => {
      result.current.choose('light');
    });

    expect(result.current.kind).toBe('light');
  });
});

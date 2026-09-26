import { afterEach, describe, expect, test, vi } from 'vitest';

import { getRuntimeConfig, loadRuntimeConfig, RuntimeConfigError } from './runtime-config';

const respondWith = (body: string, status = 200, contentType = 'application/json') =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(body, { status, headers: { 'Content-Type': contentType } }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadRuntimeConfig', () => {
  test('принимает относительный путь и отдаёт его через getRuntimeConfig', async () => {
    const fetchMock = respondWith(JSON.stringify({ apiBaseUrl: '/api' }));

    await expect(loadRuntimeConfig()).resolves.toEqual({ apiBaseUrl: '/api' });
    expect(getRuntimeConfig()).toEqual({ apiBaseUrl: '/api' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/config.json',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  test.each([
    ['абсолютный URL', 'https://evil.example/api'],
    ['протокол-относительный URL', '//evil.example/api'],
    ['обратная косая после слеша', '/\\evil.example/api'],
    ['неразбираемый URL', '//'],
    ['javascript:', 'javascript:alert(1)'],
  ])('отклоняет %s', async (_, apiBaseUrl) => {
    respondWith(JSON.stringify({ apiBaseUrl }));

    await expect(loadRuntimeConfig()).rejects.toThrow(RuntimeConfigError);
  });

  test('отклоняет лишнее поле', async () => {
    respondWith(JSON.stringify({ apiBaseUrl: '/api', apiBaseURL: '/other' }));

    await expect(loadRuntimeConfig()).rejects.toThrow('apiBaseURL');
  });

  test('отклоняет HTML вместо конфига (SPA-fallback при отсутствии файла)', async () => {
    respondWith('<!doctype html>', 200, 'text/html');

    await expect(loadRuntimeConfig()).rejects.toThrow('ожидался JSON, получен «text/html»');
  });

  test('отклоняет повреждённый JSON', async () => {
    respondWith('{ "apiBaseUrl": ');

    await expect(loadRuntimeConfig()).rejects.toThrow('/config.json: некорректный JSON');
  });

  test('сетевая ошибка превращается в RuntimeConfigError', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(loadRuntimeConfig()).rejects.toBeInstanceOf(RuntimeConfigError);
  });

  test('отклоняет ответ 404', async () => {
    respondWith('Not Found', 404);

    await expect(loadRuntimeConfig()).rejects.toThrow('HTTP 404');
  });
});

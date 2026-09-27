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
    const config = {
      apiBaseUrl: '/api',
      basemapUrl: '/basemap/moscow.pmtiles',
      demoMode: 'available',
      serverCapabilities: ['obstacles', 'runs'],
    };
    const fetchMock = respondWith(JSON.stringify(config));

    await expect(loadRuntimeConfig()).resolves.toEqual({ ...config, imagery: null });
    expect(getRuntimeConfig()).toEqual({ ...config, imagery: null });
    expect(fetchMock).toHaveBeenCalledWith(
      '/config.json',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  test('basemapUrl: null выключает подложку', async () => {
    respondWith(JSON.stringify({ apiBaseUrl: '/api', basemapUrl: null }));

    await expect(loadRuntimeConfig()).resolves.toMatchObject({ basemapUrl: null });
  });

  test('без demoMode и serverCapabilities — демо выключено, возможностей нет', async () => {
    respondWith(JSON.stringify({ apiBaseUrl: '/api', basemapUrl: null }));

    await expect(loadRuntimeConfig()).resolves.toEqual({
      apiBaseUrl: '/api',
      basemapUrl: null,
      imagery: null,
      demoMode: 'off',
      serverCapabilities: [],
    });
  });

  describe('imagery', () => {
    const imagery = {
      tilesUrl:
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      labelsUrl:
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Powered by Esri',
    };
    const withImagery = (value: unknown) =>
      respondWith(JSON.stringify({ apiBaseUrl: '/api', basemapUrl: null, imagery: value }));

    test('принимает снимок по https с шаблоном {z}/{y}/{x}', async () => {
      withImagery(imagery);

      await expect(loadRuntimeConfig()).resolves.toMatchObject({ imagery });
    });

    test('null — снимка нет', async () => {
      withImagery(null);

      await expect(loadRuntimeConfig()).resolves.toMatchObject({ imagery: null });
    });

    test.each([
      ['http вместо https', { ...imagery, tilesUrl: imagery.tilesUrl.replace('https', 'http') }],
      ['не https-схема', { ...imagery, labelsUrl: 'javascript:alert(1)//{z}/{y}/{x}' }],
      ['без шаблона', { ...imagery, tilesUrl: 'https://tiles.example.org/{z}/{x}/{y}' }],
      ['без атрибуции', { ...imagery, attribution: '' }],
      ['лишнее поле', { ...imagery, maxZoom: 21 }],
    ])('отклоняет: %s', async (_name, value) => {
      withImagery(value);

      await expect(loadRuntimeConfig()).rejects.toThrow('imagery');
    });
  });

  test('отклоняет неизвестный demoMode', async () => {
    respondWith(JSON.stringify({ apiBaseUrl: '/api', basemapUrl: null, demoMode: 'on' }));

    await expect(loadRuntimeConfig()).rejects.toThrow('demoMode');
  });

  test('неизвестная возможность отбрасывается с предупреждением, а не ошибкой', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    respondWith(
      JSON.stringify({
        apiBaseUrl: '/api',
        basemapUrl: null,
        serverCapabilities: ['norms', 'teleport', 'species'],
      }),
    );

    await expect(loadRuntimeConfig()).resolves.toMatchObject({
      serverCapabilities: ['norms', 'species'],
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('teleport'));
  });

  test('отклоняет serverCapabilities не списком строк', async () => {
    respondWith(
      JSON.stringify({ apiBaseUrl: '/api', basemapUrl: null, serverCapabilities: 'all' }),
    );

    await expect(loadRuntimeConfig()).rejects.toThrow('serverCapabilities');
  });

  test('отклоняет конфиг без basemapUrl', async () => {
    respondWith(JSON.stringify({ apiBaseUrl: '/api' }));

    await expect(loadRuntimeConfig()).rejects.toThrow('basemapUrl');
  });

  describe.each(['apiBaseUrl', 'basemapUrl'])('%s', (field) => {
    test.each([
      ['абсолютный URL', 'https://evil.example/api'],
      ['протокол-относительный URL', '//evil.example/api'],
      ['обратная косая после слеша', '/\\evil.example/api'],
      ['неразбираемый URL', '//'],
      ['javascript:', 'javascript:alert(1)'],
    ])('отклоняет %s', async (_, value) => {
      respondWith(JSON.stringify({ apiBaseUrl: '/api', basemapUrl: null, [field]: value }));

      await expect(loadRuntimeConfig()).rejects.toThrow(RuntimeConfigError);
    });
  });

  test('отклоняет лишнее поле', async () => {
    respondWith(JSON.stringify({ apiBaseUrl: '/api', basemapUrl: null, apiBaseURL: '/other' }));

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

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { resolveDataSource, switchDataSource, unregisterMockWorker } from './data-source';

const KEY = 'greenleaders:data-source';

describe('resolveDataSource', () => {
  test.each([
    ['без выбора — сервер: жюри видит факт', '', null, 'development', 'server'],
    ['без выбора, npm run dev:mock — демо', '', null, 'mock', 'demo'],
    ['сохранённый выбор важнее скрипта', '', 'server', 'mock', 'server'],
    ['сохранённый выбор важнее скрипта', '', 'demo', 'development', 'demo'],
    ['параметр адреса важнее сохранённого', '?data=server', 'demo', 'mock', 'server'],
    ['параметр адреса важнее сохранённого', '?data=demo', 'server', 'development', 'demo'],
    ['?data=mock — прежнее имя демо', '?data=mock', 'server', 'development', 'demo'],
    ['сохранённое «mock» — прежнее имя демо', '', 'mock', 'development', 'demo'],
    ['чужое значение параметра не учитывается', '?data=prod', 'demo', 'development', 'demo'],
    ['чужое сохранённое значение не учитывается', '', 'yes', 'mock', 'demo'],
  ] as const)('%s', (_, search, stored, mode, expected) => {
    expect(resolveDataSource({ search, stored, mode, demoMode: 'available' })).toBe(expected);
  });

  test('демо выключено в конфиге — только сервер, что бы ни было в адресе и хранилище', () => {
    expect(
      resolveDataSource({ search: '?data=demo', stored: 'demo', mode: 'mock', demoMode: 'off' }),
    ).toBe('server');
  });
});

describe('хранилище и перезагрузка', () => {
  const unregister = vi.fn(() => Promise.resolve(true));

  beforeEach(() => {
    history.replaceState(null, '', '/projects?data=demo');
    // jsdom не реализует Service Worker.
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistrations: () =>
          Promise.resolve([
            { active: { scriptURL: 'http://localhost/mockServiceWorker.js' }, unregister },
            { active: { scriptURL: 'http://localhost/other-worker.js' }, unregister: vi.fn() },
          ]),
      },
    });
  });

  afterEach(() => {
    vi.doUnmock('./runtime-config');
    vi.restoreAllMocks();
    unregister.mockClear();
    Reflect.deleteProperty(navigator, 'serviceWorker');
    history.replaceState(null, '', '/');
  });

  // Источник фиксируется в модуле при старте: каждый запуск — свежий экземпляр модуля
  // с конфигом, в котором демо разрешено.
  const startApp = async () => {
    vi.resetModules();
    vi.doMock('./runtime-config', () => ({
      getRuntimeConfig: () => ({ demoMode: 'available' }),
    }));
    return (await import('./data-source')).currentDataSource;
  };

  test('хранилище недоступно — выбор по адресу или скрипту, без исключения', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect((await startApp())()).toBe('demo');
    history.replaceState(null, '', '/projects');
    // В тестах MODE — «test»: как у npm run dev, умолчание — сервер.
    expect((await startApp())()).toBe('server');
  });

  test('источник решается при старте: навигация без ?data= его не меняет', async () => {
    const current = await startApp();

    expect(current()).toBe('demo');
    history.replaceState(null, '', '/projects/abc');
    expect(current()).toBe('demo');
  });

  test('регистрации недоступны (хранилище запрещено) — ошибки нет', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistrations: () => Promise.reject(new DOMException('denied', 'SecurityError')),
      },
    });

    await expect(unregisterMockWorker()).resolves.toBeUndefined();
  });

  test('без Service Worker (http:// не с localhost) снимать нечего, ошибки нет', async () => {
    Reflect.deleteProperty(navigator, 'serviceWorker');

    await expect(unregisterMockWorker()).resolves.toBeUndefined();
  });

  test('на сервер: выбор записан, воркер моков снят, параметр адреса убран', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);
    const reload = vi.fn();

    await switchDataSource('server', reload);

    expect(setItem).toHaveBeenCalledWith(KEY, 'server');
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledWith(`${location.origin}/projects`);
  });

  test('на демо: воркер не трогается, страница перезагружается', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);
    const reload = vi.fn();

    await switchDataSource('demo', reload);

    expect(setItem).toHaveBeenCalledWith(KEY, 'demo');
    expect(unregister).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('со страницы проекта — на список проектов нового режима, с keepPath — на месте', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);
    const reload = vi.fn();
    history.replaceState(null, '', '/projects/5c0b7f2e9a3d4e61b8f0c2a7d9e4b1f3/report?view=x');

    await switchDataSource('demo', reload);
    expect(reload).toHaveBeenLastCalledWith(`${location.origin}/`);

    await switchDataSource('demo', reload, true);
    expect(reload).toHaveBeenLastCalledWith(
      `${location.origin}/projects/5c0b7f2e9a3d4e61b8f0c2a7d9e4b1f3/report?view=x`,
    );
    history.replaceState(null, '', '/projects');
  });

  test('«Проекты», «Геопривязка», «Новый проект» — маршрут сохраняется', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);
    const reload = vi.fn();

    for (const path of ['/', '/georeference', '/projects/new']) {
      history.replaceState(null, '', path);
      await switchDataSource('demo', reload);
      expect(reload).toHaveBeenLastCalledWith(`${location.origin}${path}`);
    }
    history.replaceState(null, '', '/projects');
  });

  test('хранилище недоступно — выбор переносится в адрес', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const reload = vi.fn();

    await switchDataSource('server', reload);

    expect(reload).toHaveBeenCalledWith(`${location.origin}/projects?data=server`);
  });

  test('снимается только воркер моков', async () => {
    await unregisterMockWorker();

    expect(unregister).toHaveBeenCalledTimes(1);
  });
});

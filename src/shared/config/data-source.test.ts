import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { resolveDataSource, switchDataSource, unregisterMockWorker } from './data-source';

const KEY = 'greenleaders:data-source';

describe('resolveDataSource', () => {
  test.each([
    ['без выбора, npm run dev — сервер', '', null, 'development', 'server'],
    ['без выбора, npm run dev:mock — моки', '', null, 'mock', 'mock'],
    ['сохранённый выбор важнее скрипта', '', 'server', 'mock', 'server'],
    ['сохранённый выбор важнее скрипта', '', 'mock', 'development', 'mock'],
    ['параметр адреса важнее сохранённого', '?data=server', 'mock', 'mock', 'server'],
    ['параметр адреса важнее сохранённого', '?data=mock', 'server', 'development', 'mock'],
    ['чужое значение параметра не учитывается', '?data=prod', 'mock', 'development', 'mock'],
    ['чужое сохранённое значение не учитывается', '', 'yes', 'mock', 'mock'],
  ] as const)('%s', (_, search, stored, mode, expected) => {
    expect(resolveDataSource({ search, stored, mode })).toBe(expected);
  });
});

describe('хранилище и перезагрузка', () => {
  const unregister = vi.fn(() => Promise.resolve(true));

  beforeEach(() => {
    history.replaceState(null, '', '/projects?data=mock');
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
    vi.restoreAllMocks();
    unregister.mockClear();
    Reflect.deleteProperty(navigator, 'serviceWorker');
    history.replaceState(null, '', '/');
  });

  // Источник фиксируется в модуле при старте: каждый запуск — свежий экземпляр модуля.
  const startApp = async () => {
    vi.resetModules();
    return (await import('./data-source')).currentDataSource;
  };

  test('хранилище недоступно — выбор по адресу или скрипту, без исключения', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect((await startApp())()).toBe('mock');
    history.replaceState(null, '', '/projects');
    // В тестах MODE — «test»: как у npm run dev, умолчание — сервер.
    expect((await startApp())()).toBe('server');
  });

  test('источник решается при старте: навигация без ?data= его не меняет', async () => {
    const current = await startApp();

    expect(current()).toBe('mock');
    history.replaceState(null, '', '/projects/abc');
    expect(current()).toBe('mock');
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

  test('на моки: воркер не трогается, страница перезагружается', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);
    const reload = vi.fn();

    await switchDataSource('mock', reload);

    expect(setItem).toHaveBeenCalledWith(KEY, 'mock');
    expect(unregister).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
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

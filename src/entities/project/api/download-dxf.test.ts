import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { server } from '@/shared/lib/test';

import { downloadProjectDxf, fetchProjectDxf } from './download-dxf';

const READY_ID = '5c0b7f2e9a3d4e61b8f0c2a7d9e4b1f3';

describe('downloadProjectDxf', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  test('скачивает файл под именем проекта и освобождает объектный URL', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    // jsdom не реализует объектные URL: методы добавляются на время теста.
    const createObjectURL = vi.fn(() => 'blob:dxf');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const error = await downloadProjectDxf({ id: READY_ID, name: 'Сквер: этап 1' });

    expect(error).toBeNull();
    expect(click).toHaveBeenCalledTimes(1);
    const link = click.mock.contexts[0];
    expect(link).toBeInstanceOf(HTMLAnchorElement);
    expect((link as HTMLAnchorElement).download).toBe('Сквер_ этап 1.dxf');
    expect((link as HTMLAnchorElement).href).toBe('blob:dxf');
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:dxf');
  });

  test('ошибка сервера — сообщение, файл не скачивается', async () => {
    server.use(
      http.get('/api/projects/:projectId/dxf', () => new HttpResponse(null, { status: 500 })),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');

    await expect(downloadProjectDxf({ id: READY_ID, name: 'Сквер' })).resolves.toMatch(/^Сервер/);
    expect(click).not.toHaveBeenCalled();
  });

  test('сеть недоступна — сообщение о связи', async () => {
    server.use(http.get('/api/projects/:projectId/dxf', () => HttpResponse.error()));

    await expect(downloadProjectDxf({ id: READY_ID, name: 'Сквер' })).resolves.toBe(
      'Нет связи с сервером. Проверьте подключение и повторите попытку.',
    );
  });
});

// DXF версии сервер собирает в фоне: 202 с Retry-After, пока не готов
// (../backend/greenplan/api/app.py, _version_file).
describe('fetchProjectDxf — версия плана посадок', () => {
  const VERSION_DXF = '/api/projects/:projectId/plantings/:version/dxf';

  afterEach(() => {
    vi.useRealTimers();
  });

  test('202 — ждёт столько, сколько просит Retry-After, и скачивает готовый файл', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const requests: number[] = [];
    server.use(
      http.get(VERSION_DXF, ({ params }) => {
        requests.push(Date.now());
        expect(params.version).toBe('2');
        return requests.length < 3
          ? HttpResponse.json(
              { version: 2, export_status: 'pending' },
              { status: 202, headers: { 'Retry-After': '5' } },
            )
          : new HttpResponse('0\r\nSECTION', { headers: { 'Content-Type': 'image/vnd.dxf' } });
      }),
    );

    const pending = fetchProjectDxf(READY_ID, 2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;

    expect(requests).toHaveLength(3);
    expect(result.kind).toBe('file');
    if (result.kind === 'file') expect(await result.file.text()).toBe('0\r\nSECTION');
  });

  test('собирается дольше трёх минут — просит повторить позже, а не сохраняет ответ 202', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    server.use(
      http.get(VERSION_DXF, () =>
        HttpResponse.json(
          { version: 2, export_status: 'pending' },
          { status: 202, headers: { 'Retry-After': '30' } },
        ),
      ),
    );

    const pending = fetchProjectDxf(READY_ID, 2);
    await vi.advanceTimersByTimeAsync(200_000);

    await expect(pending).resolves.toEqual({
      kind: 'error',
      message: 'DXF версии ещё собирается на сервере. Повторите скачивание через минуту.',
    });
  });

  test('о сборке сообщает один раз; уход с экрана отменяет ожидание без сообщения', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    let requests = 0;
    server.use(
      http.get(VERSION_DXF, () => {
        requests += 1;
        return HttpResponse.json(
          { version: 2, export_status: 'pending' },
          { status: 202, headers: { 'Retry-After': '5' } },
        );
      }),
    );
    const onPending = vi.fn();
    const controller = new AbortController();

    const pending = fetchProjectDxf(READY_ID, 2, { signal: controller.signal, onPending });
    await vi.advanceTimersByTimeAsync(5000);
    controller.abort();

    await expect(pending).resolves.toEqual({ kind: 'aborted' });
    expect(onPending).toHaveBeenCalledTimes(1);
    expect(requests).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requests).toBe(2);
  });

  test.each([
    [409, 'transform_unavailable', /^Проект обработан до появления версий/],
    [500, 'export_failed', /^Сервер не смог собрать DXF этой версии/],
  ])('%i %s — объяснение, что делать', async (status, code, message) => {
    server.use(
      http.get(VERSION_DXF, () =>
        HttpResponse.json({ detail: { code, message: 'details' } }, { status }),
      ),
    );

    const result = await fetchProjectDxf(READY_ID, 2);

    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.message).toMatch(message);
  });
});

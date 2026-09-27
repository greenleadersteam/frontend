import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { server } from '@/shared/lib/test';

import { downloadProjectDxf } from './download-dxf';

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

  test('ошибка сервера — AppError, файл не скачивается', async () => {
    server.use(
      http.get('/api/projects/:projectId/dxf', () => new HttpResponse(null, { status: 500 })),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');

    await expect(downloadProjectDxf({ id: READY_ID, name: 'Сквер' })).resolves.toEqual({
      kind: 'http',
      status: 500,
      message: null,
    });
    expect(click).not.toHaveBeenCalled();
  });

  test('сеть недоступна — network', async () => {
    server.use(http.get('/api/projects/:projectId/dxf', () => HttpResponse.error()));

    await expect(downloadProjectDxf({ id: READY_ID, name: 'Сквер' })).resolves.toEqual({
      kind: 'network',
    });
  });
});

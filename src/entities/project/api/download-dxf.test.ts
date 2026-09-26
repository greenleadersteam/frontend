import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { server } from '@/shared/lib/test';

import { downloadProjectDxf, dxfFileName } from './download-dxf';

const READY_ID = '5c0b7f2e9a3d4e61b8f0c2a7d9e4b1f3';

describe('dxfFileName', () => {
  test.each([
    ['Сквер на Покровке', 'Сквер на Покровке.dxf'],
    ['Улица Маросейка, 7/9', 'Улица Маросейка, 7_9.dxf'],
    ['Этап 1: проект', 'Этап 1_ проект.dxf'],
    ['a\\b*c?d"e<f>g|h', 'a_b_c_d_e_f_g_h.dxf'],
    ['  двойные   пробелы\tи табуляция  ', 'двойные пробелы и табуляция.dxf'],
    ['Точка в конце.', 'Точка в конце.dxf'],
    ['...', 'план посадок.dxf'],
    ['', 'план посадок.dxf'],
  ])('%j → %j', (name, fileName) => {
    expect(dxfFileName(name)).toBe(fileName);
  });

  test('управляющие символы заменяются', () => {
    expect(dxfFileName('a\u0000b\u001Fc\u007Fd')).toBe('a_b_c_d.dxf');
  });

  test('длинное название обрезается до 120 символов, кириллица не рвётся', () => {
    const fileName = dxfFileName('Ж'.repeat(300));

    expect(fileName).toBe(`${'Ж'.repeat(120)}.dxf`);
    expect(new TextEncoder().encode(fileName).length).toBeLessThanOrEqual(255);
  });
});

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

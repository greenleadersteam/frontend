import { describe, expect, test } from 'vitest';

import { describeAppError, toAppError } from './app-error';

describe('toAppError', () => {
  test('FETCH_ERROR — нет связи', () => {
    expect(toAppError({ status: 'FETCH_ERROR', error: 'TypeError: Failed to fetch' })).toEqual({
      kind: 'network',
    });
  });

  test('TIMEOUT_ERROR — таймаут', () => {
    expect(toAppError({ status: 'TIMEOUT_ERROR', error: 'AbortError' })).toEqual({
      kind: 'timeout',
    });
  });

  test('detail-строка FastAPI попадает в message', () => {
    expect(toAppError({ status: 404, data: { detail: 'Project not found' } })).toEqual({
      kind: 'http',
      status: 404,
      message: 'Project not found',
    });
  });

  test('422 с массивом detail — поля по последнему элементу loc', () => {
    const data = {
      detail: [
        { loc: ['body', 'name'], msg: 'Field required', type: 'missing' },
        { loc: ['body', 'files', 0], msg: 'Invalid file', type: 'value_error' },
      ],
    };

    expect(toAppError({ status: 422, data })).toEqual({
      kind: 'validation',
      fields: { name: 'Field required', files: 'Invalid file' },
    });
  });

  test('422 с телом не той формы — обычная HTTP-ошибка', () => {
    expect(toAppError({ status: 422, data: { detail: [{ message: 'x' }] } })).toEqual({
      kind: 'http',
      status: 422,
      message: null,
    });
  });

  test('тело не JSON — HTTP-ошибка с исходным статусом', () => {
    expect(
      toAppError({
        status: 'PARSING_ERROR',
        originalStatus: 502,
        data: '<html>Bad Gateway</html>',
        error: 'SyntaxError',
      }),
    ).toEqual({ kind: 'http', status: 502, message: null });
  });

  test('тело не JSON при статусе 200 — неизвестная ошибка, а не отказ сервера', () => {
    expect(
      toAppError({ status: 'PARSING_ERROR', originalStatus: 200, data: 'x', error: 'SyntaxError' }),
    ).toEqual({ kind: 'unknown' });
  });

  test('HTTP-ошибка без тела', () => {
    expect(toAppError({ status: 500, data: null })).toEqual({
      kind: 'http',
      status: 500,
      message: null,
    });
  });

  test('CUSTOM_ERROR, SerializedError и undefined — неизвестная ошибка', () => {
    expect(toAppError({ status: 'CUSTOM_ERROR', error: 'x' })).toEqual({ kind: 'unknown' });
    expect(toAppError({ name: 'Error', message: 'boom' })).toEqual({ kind: 'unknown' });
    expect(toAppError(undefined)).toEqual({ kind: 'unknown' });
  });
});

describe('describeAppError', () => {
  test.each([
    [{ kind: 'network' } as const, 'Нет связи с сервером.'],
    [{ kind: 'timeout' } as const, 'Сервер не ответил вовремя.'],
    [{ kind: 'http', status: 404, message: null } as const, 'Данные не найдены'],
    [{ kind: 'http', status: 503, message: null } as const, 'Сервер не смог обработать запрос.'],
    [{ kind: 'http', status: 400, message: null } as const, 'Сервер отклонил запрос.'],
    [{ kind: 'http', status: 409, message: null } as const, 'в текущем состоянии проекта'],
    [{ kind: 'http', status: 413, message: null } as const, 'Архив больше 100\u00A0МБ.'],
    [{ kind: 'http', status: 429, message: null } as const, 'Повторите через минуту.'],
    [{ kind: 'validation', fields: { name: 'x' } } as const, 'Сервер не принял данные.'],
    [{ kind: 'unknown' } as const, 'Что-то пошло не так.'],
  ])('%o', (error, expected) => {
    expect(describeAppError(error)).toContain(expected);
  });

  test('не показывает внутреннее сообщение сервера', () => {
    expect(
      describeAppError({ kind: 'http', status: 400, message: 'psycopg.errors.UniqueViolation' }),
    ).not.toContain('psycopg');
  });
});

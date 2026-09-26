import { File as NodeFile } from 'node:buffer';

import { delay, http, HttpResponse } from 'msw';
import { describe, expect, test, vi } from 'vitest';

import { MAX_ARCHIVE_BYTES } from './archive-limit';
import { uploadArchive } from './archive-upload';
import { server } from './mocks/node';

// Перехватчик XHR в MSW не читает тело, если это File из jsdom (приходит строка «undefined»),
// а File из Node передаёт целиком. На код модуля подмена не влияет: он лишь передаёт файл в send.
vi.stubGlobal('File', NodeFile);

const DRAFT_ID = '9a1c3e5b7d2f4a6c8e0b2d4f6a8c1e3b';
const READY_ID = '5c0b7f2e9a3d4e61b8f0c2a7d9e4b1f3';
const uploadUrl = (id: string) => `/api/projects/${id}/upload`;

const archive = (bytes: number, name = 'site.zip') => new File([new Uint8Array(bytes)], name);

describe('uploadArchive', () => {
  test('архив принят: прогресс доходит до размера файла, проект встаёт в очередь', async () => {
    const onProgress = vi.fn();

    await expect(uploadArchive(DRAFT_ID, archive(4096), { onProgress })).resolves.toEqual({
      kind: 'accepted',
    });
    expect(onProgress).toHaveBeenLastCalledWith({ sentBytes: 4096, totalBytes: 4096 });
    const project: unknown = await (await fetch(`/api/projects/${DRAFT_ID}`)).json();
    expect(project).toMatchObject({ status: 'queued' });
  });

  test('отправляет сырые байты с Content-Type application/zip и именем в заголовке', async () => {
    const received = vi.fn();
    server.use(
      http.post(uploadUrl(DRAFT_ID), async ({ request }) => {
        received({
          contentType: request.headers.get('Content-Type'),
          filename: request.headers.get('X-Upload-Filename'),
          size: (await request.arrayBuffer()).byteLength,
        });
        return new HttpResponse(null, { status: 202 });
      }),
    );

    await uploadArchive(DRAFT_ID, archive(10, 'Покровка, этап 1.zip'));

    expect(received).toHaveBeenCalledWith({
      contentType: 'application/zip',
      filename: encodeURIComponent('Покровка, этап 1.zip'),
      size: 10,
    });
  });

  test.each([
    ['нет проекта — 404', 'unknown', archive(10), 404, 'Project not found'],
    [
      'статус не позволяет — 409',
      READY_ID,
      archive(10),
      409,
      "Project is not uploadable in status 'ready'",
    ],
    ['пустое тело — 400', DRAFT_ID, archive(0), 400, 'No file body provided'],
    [
      'все слоты заняты — 429',
      DRAFT_ID,
      archive(10, 'busy.zip'),
      429,
      'Too many concurrent processing jobs, try again later',
    ],
  ])('%s', async (_, projectId, file, status, message) => {
    await expect(uploadArchive(projectId, file)).resolves.toEqual({
      kind: 'failed',
      error: { kind: 'http', status, message },
    });
  });

  test('архив больше лимита — 413', async () => {
    await expect(uploadArchive(DRAFT_ID, archive(MAX_ARCHIVE_BYTES + 1))).resolves.toEqual({
      kind: 'failed',
      error: { kind: 'http', status: 413, message: 'Upload exceeds the maximum allowed size' },
    });
  });

  test('обрыв соединения — сетевая ошибка', async () => {
    server.use(http.post(uploadUrl(DRAFT_ID), () => HttpResponse.error()));

    await expect(uploadArchive(DRAFT_ID, archive(10))).resolves.toEqual({
      kind: 'failed',
      error: { kind: 'network' },
    });
  });

  test('отмена во время загрузки', async () => {
    const started = vi.fn();
    server.use(
      http.post(uploadUrl(DRAFT_ID), async () => {
        started();
        await delay('infinite');
        return new HttpResponse(null, { status: 202 });
      }),
    );
    const controller = new AbortController();

    const result = uploadArchive(DRAFT_ID, archive(10), { signal: controller.signal });
    await vi.waitFor(() => {
      expect(started).toHaveBeenCalled();
    });
    controller.abort();

    await expect(result).resolves.toEqual({ kind: 'aborted' });
  });

  test('уже отменённый сигнал — запрос не отправляется', async () => {
    const received = vi.fn();
    server.use(
      http.post(uploadUrl(DRAFT_ID), () => {
        received();
        return new HttpResponse(null, { status: 202 });
      }),
    );

    await expect(
      uploadArchive(DRAFT_ID, archive(10), { signal: AbortSignal.abort() }),
    ).resolves.toEqual({ kind: 'aborted' });
    expect(received).not.toHaveBeenCalled();
  });
});

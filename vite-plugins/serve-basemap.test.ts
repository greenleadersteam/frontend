import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

import { parseRange, resolveInside, serveDirectory } from './serve-basemap.ts';

describe('parseRange', () => {
  test.each([
    ['bytes=0-9', { start: 0, end: 9 }],
    ['bytes=10-', { start: 10, end: 99 }],
    ['bytes=-10', { start: 90, end: 99 }],
    ['bytes=-1000', { start: 0, end: 99 }],
    ['bytes=90-1000', { start: 90, end: 99 }],
  ])('%s → диапазон', (header, range) => {
    expect(parseRange(header, 100)).toEqual(range);
  });

  test.each(['bytes=100-', 'bytes=200-300', 'bytes=-0'])('%s → 416', (header) => {
    expect(parseRange(header, 100)).toBe('unsatisfiable');
  });

  test.each([undefined, 'bytes=-', 'bytes=9-0', 'bytes=0-1,5-9', 'items=0-9', 'bytes=a-b'])(
    '%s → весь файл',
    (header) => {
      expect(parseRange(header, 100)).toBeNull();
    },
  );
});

describe('resolveInside', () => {
  const root = path.resolve('/srv/basemap');

  test('файл внутри корня', () => {
    expect(resolveInside(root, '/moscow.pmtiles')).toBe(path.join(root, 'moscow.pmtiles'));
  });

  test.each([
    '/../secret',
    '/%2e%2e/secret',
    '/%2E%2E%2Fsecret',
    '/fonts/../../secret',
    '/..%5csecret',
    '/%00',
    '/%E0%A4%A',
    '/',
  ])('%s — вне корня или неразбираемый', (urlPath) => {
    const file = resolveInside(root, urlPath);
    if (file !== null) expect(path.relative(root, file).split(path.sep)[0]).not.toBe('..');
  });

  test('..%2f не выходит за корень', () => {
    expect(resolveInside(root, '/..%2f..%2fetc%2fpasswd')).toBe(path.join(root, 'etc', 'passwd'));
  });
});

type Served = { status: number; headers: Record<string, string>; body: string };

// Ответ connect-мидлвары собирается в память: MSW в тестах перехватывает сетевые запросы,
// поэтому настоящий HTTP-сервер здесь не поднимается.
async function serve(
  root: string,
  url: string,
  headers: Record<string, string> = {},
  method = 'GET',
): Promise<Served> {
  const chunks: Buffer[] = [];
  const responseHeaders: Record<string, string> = {};
  const response = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });
  const fake = Object.assign(response, {
    statusCode: 200,
    setHeader(name: string, value: string) {
      responseHeaders[name.toLowerCase()] = value;
    },
  });
  const done = new Promise<void>((resolve) => response.on('finish', resolve));
  const next = vi.fn();

  // Мидлвара читает только method, url и headers.
  const request = { method, url, headers } as unknown as IncomingMessage;
  serveDirectory(root)(request, fake as unknown as ServerResponse, next);
  await done;

  return {
    status: fake.statusCode,
    headers: responseHeaders,
    body: Buffer.concat(chunks).toString(),
  };
}

describe('serveDirectory', () => {
  let outer: string;
  let root: string;
  const content = '0123456789abcdefghij';

  beforeAll(async () => {
    // Файл «снаружи» лежит рядом с корнем, но внутри своего временного каталога.
    outer = await mkdtemp(path.join(tmpdir(), 'serve-basemap-'));
    root = path.join(outer, 'basemap');
    await mkdir(root);
    await writeFile(path.join(root, 'moscow.pmtiles'), content);
    await mkdir(path.join(root, 'fonts'));
    await writeFile(path.join(outer, 'outside.txt'), 'secret');
  });

  afterAll(async () => {
    await rm(outer, { recursive: true });
  });

  test('без Range — 200 и файл целиком', async () => {
    const served = await serve(root, '/moscow.pmtiles');

    expect(served.status).toBe(200);
    expect(served.body).toBe(content);
    expect(served.headers).toMatchObject({
      'accept-ranges': 'bytes',
      'content-type': 'application/vnd.pmtiles',
      'content-length': '20',
    });
    expect(served.headers.etag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
  });

  test('Range — 206 и Content-Range', async () => {
    const served = await serve(root, '/moscow.pmtiles', { range: 'bytes=5-9' });

    expect(served.status).toBe(206);
    expect(served.body).toBe('56789');
    expect(served.headers['content-range']).toBe('bytes 5-9/20');
    expect(served.headers['content-length']).toBe('5');
  });

  test('Range за концом файла — 416', async () => {
    const served = await serve(root, '/moscow.pmtiles', { range: 'bytes=20-' });

    expect(served.status).toBe(416);
    expect(served.headers['content-range']).toBe('bytes */20');
    expect(served.body).toBe('');
  });

  test('совпавший ETag — 304 без тела', async () => {
    const { headers } = await serve(root, '/moscow.pmtiles');
    const served = await serve(root, '/moscow.pmtiles', { 'if-none-match': headers.etag ?? '' });

    expect(served.status).toBe(304);
    expect(served.body).toBe('');
  });

  test('HEAD — заголовки без тела', async () => {
    const served = await serve(root, '/moscow.pmtiles', {}, 'HEAD');

    expect(served.status).toBe(200);
    expect(served.headers['content-length']).toBe('20');
    expect(served.body).toBe('');
  });

  test.each(['/missing.pmtiles', '/fonts'])('%s — 404', async (url) => {
    expect((await serve(root, url)).status).toBe(404);
  });

  test.each(['/../outside.txt', '/%2e%2e/outside.txt', '/%2E%2E%2Foutside.txt'])(
    '%s — 404, файл вне папки не отдаётся',
    async (url) => {
      const served = await serve(root, url);

      expect(served.status).toBe(404);
      expect(served.body).not.toContain('secret');
    },
  );
});

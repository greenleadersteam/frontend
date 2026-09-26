import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { Connect, Plugin } from 'vite';

const BASEMAP_URL_PREFIX = '/basemap';

const CONTENT_TYPES: Record<string, string> = {
  '.pmtiles': 'application/vnd.pmtiles',
};

type ByteRange = { start: number; end: number };

// Один диапазон по RFC 9110, п. 14.1.2: PMTiles читает архив только так. Несколько диапазонов
// и синтаксически неверный заголовок игнорируются — сервер вправе ответить файлом целиком (200).
export function parseRange(
  header: string | undefined,
  size: number,
): ByteRange | 'unsatisfiable' | null {
  const match = header === undefined ? null : /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return null;
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return null;

  if (first === '') {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  if (last !== '' && Number(last) < start) return null;
  if (start >= size) return 'unsatisfiable';
  return { start, end: last === '' ? size - 1 : Math.min(Number(last), size - 1) };
}

// Путь из адреса — недоверенные данные: после декодирования (%2e%2e → ..) он не должен
// выйти за пределы корня.
export function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const file = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`);
  return file.startsWith(root + path.sep) ? file : null;
}

export function serveDirectory(root: string): Connect.NextHandleFunction {
  return (request, response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      next();
      return;
    }
    const file = resolveInside(root, new URL(request.url ?? '/', 'http://localhost').pathname);
    if (file === null) {
      response.statusCode = 404;
      response.end();
      return;
    }

    stat(file).then(
      (stats) => {
        if (!stats.isFile()) {
          response.statusCode = 404;
          response.end();
          return;
        }
        const etag = `"${stats.size.toString(16)}-${Math.trunc(stats.mtimeMs).toString(16)}"`;
        response.setHeader('ETag', etag);
        response.setHeader('Accept-Ranges', 'bytes');
        response.setHeader('Cache-Control', 'no-cache');
        response.setHeader(
          'Content-Type',
          CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
        );
        if (request.headers['if-none-match'] === etag) {
          response.statusCode = 304;
          response.end();
          return;
        }

        const range = parseRange(request.headers.range, stats.size);
        if (range === 'unsatisfiable') {
          response.statusCode = 416;
          response.setHeader('Content-Range', `bytes */${String(stats.size)}`);
          response.end();
          return;
        }
        const { start, end } = range ?? { start: 0, end: stats.size - 1 };
        response.statusCode = range === null ? 200 : 206;
        if (range !== null) {
          response.setHeader(
            'Content-Range',
            `bytes ${String(start)}-${String(end)}/${String(stats.size)}`,
          );
        }
        response.setHeader('Content-Length', String(Math.max(0, end - start + 1)));
        if (request.method === 'HEAD' || stats.size === 0) {
          response.end();
          return;
        }
        createReadStream(file, { start, end })
          .on('error', () => response.destroy())
          .pipe(response);
      },
      () => {
        response.statusCode = 404;
        response.end();
      },
    );
  };
}

// Подложка в разработке: .data/ не входит ни в public/, ни в dist. В production тот же путь
// раздаёт nginx.
export function serveBasemap(root: string): Plugin {
  const handler = serveDirectory(path.resolve(root));
  return {
    name: 'serve-basemap',
    configureServer(server) {
      server.middlewares.use(BASEMAP_URL_PREFIX, handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(BASEMAP_URL_PREFIX, handler);
    },
  };
}

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

import { serveBasemap } from './vite-plugins/serve-basemap.ts';

const DEFAULT_API_PROXY_TARGET = 'https://backend.greenleaders.online';

// CSP production из .claude/rules/security.md: preview проверяет сборку в тех же условиях.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// Воркер MSW раздаёт только dev-сервер в режиме mock прямо из node_modules: в public/ его нет,
// поэтому в dist он не попадает, а его версия всегда совпадает с установленным msw.
function mockServiceWorker(): Plugin {
  const workerPath = createRequire(import.meta.url).resolve('msw/mockServiceWorker.js');
  return {
    name: 'mock-service-worker',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/mockServiceWorker.js', (_request, response, next) => {
        readFile(workerPath).then((worker) => {
          response.setHeader('Content-Type', 'text/javascript');
          response.end(worker);
        }, next);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Третий аргумент '' читает переменные без префикса VITE_: они нужны только dev-серверу и в бандл не попадают.
  const env = loadEnv(mode, process.cwd(), '');
  const mock = mode === 'mock';

  return {
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      ...(mock ? [mockServiceWorker()] : []),
      serveBasemap(fileURLToPath(new URL('.data/basemap', import.meta.url))),
    ],
    resolve: { tsconfigPaths: true },
    server: {
      // В режиме mock прокси нет: запрос, который мок не обработал, не должен уйти на настоящий бэкенд.
      proxy: mock
        ? undefined
        : {
            // Regex-ключ: префикс '/api' совпал бы и с '/api-docs'.
            '^/api(/|$)': {
              target: env.API_PROXY_TARGET ?? DEFAULT_API_PROXY_TARGET,
              changeOrigin: true,
              secure: true,
              rewrite: (path) => path.replace(/^\/api/, ''),
            },
          },
    },
    build: { sourcemap: false },
    preview: { headers: { 'Content-Security-Policy': CONTENT_SECURITY_POLICY } },
    // Воркер MapLibre — ES-модуль, и создаётся он как модульный (type: 'module').
    worker: { format: 'es' },
    test: {
      include: ['src/**/*.test.{ts,tsx}', 'vite-plugins/**/*.test.ts'],
      environment: 'jsdom',
      setupFiles: ['./src/shared/lib/test/setup.ts'],
    },
  };
});

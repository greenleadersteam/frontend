import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

import { serveBasemap } from './vite-plugins/serve-basemap.ts';

const DEFAULT_API_PROXY_TARGET = 'https://backend.greenleaders.online';

// Космоснимок модуля геопривязки (imagery в config.dev.json и в конфиге стенда): MapLibre грузит растровые тайлы
// через fetch, поэтому источник нужен и в connect-src, и в img-src.
const IMAGERY_ORIGIN = 'https://server.arcgisonline.com';

// CSP production из .claude/rules/security.md: preview проверяет сборку в тех же условиях.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${IMAGERY_ORIGIN}`,
  "font-src 'self'",
  `connect-src 'self' ${IMAGERY_ORIGIN}`,
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// Воркер MSW — из node_modules, поэтому его версия всегда совпадает с установленным msw. Dev-сервер
// раздаёт его напрямую, сборка кладёт в dist рядом с index.html: демо — часть показа продукта.
// Регистрируется он, только если выбран режим «Демо» (src/shared/config/data-source.ts).
function mockServiceWorker(): Plugin {
  const workerPath = createRequire(import.meta.url).resolve('msw/mockServiceWorker.js');
  return {
    name: 'mock-service-worker',
    configureServer(server) {
      server.middlewares.use('/mockServiceWorker.js', (_request, response, next) => {
        readFile(workerPath).then((worker) => {
          response.setHeader('Content-Type', 'text/javascript');
          response.end(worker);
        }, next);
      });
    },
    async generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'mockServiceWorker.js',
        source: await readFile(workerPath),
      });
    },
  };
}

// Конфиг разработки: public/config.json безопасен по умолчанию для контура заказчика (без
// снимка), а dev-серверу нужен снимок. config.dev.json лежит вне public и в dist не попадает;
// dev-сервер отдаёт его по /config.json. preview и сборка его не видят.
function devRuntimeConfig(): Plugin {
  const configPath = fileURLToPath(new URL('config.dev.json', import.meta.url));
  return {
    name: 'dev-runtime-config',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/config.json', (_request, response, next) => {
        readFile(configPath).then((config) => {
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(config);
        }, next);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Третий аргумент '' читает переменные без префикса VITE_: они нужны только dev-серверу и в бандл не попадают.
  const env = loadEnv(mode, process.cwd(), '');
  const apiProxyTarget = env.API_PROXY_TARGET ?? DEFAULT_API_PROXY_TARGET;

  return {
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      mockServiceWorker(),
      devRuntimeConfig(),
      serveBasemap(fileURLToPath(new URL('.data/basemap', import.meta.url))),
    ],
    resolve: { tsconfigPaths: true },
    server: {
      // Прокси работает и на моках: запросы /api, которые моки не обработали, MSW обрывает сам
      // (src/shared/api/mocks/browser.ts), до прокси они не доходят.
      proxy: {
        // Regex-ключ: префикс '/api' совпал бы и с '/api-docs'.
        '^/api(/|$)': {
          target: apiProxyTarget,
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
      // Страховка на CI: машина медленнее и нагружена параллельными файлами. Повтор не заменяет
      // ожиданий в тестах, а защищает деплой от случайного таймаута.
      ...(process.env.CI === undefined
        ? {}
        : { retry: 2, testTimeout: 20_000, hookTimeout: 20_000 }),
    },
  };
});

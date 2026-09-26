import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const DEFAULT_API_PROXY_TARGET = 'https://backend.greenleaders.online';

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
    test: {
      include: ['src/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      setupFiles: ['./src/shared/lib/test/setup.ts'],
    },
  };
});

import '@testing-library/jest-dom/vitest';

import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';

import { cleanup } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';

import { resetMockDb, server } from '@/shared/api/mocks/node';
import { loadRuntimeConfig } from '@/shared/config';

import { installIntersectionObserver } from './intersection-observer';

// Без globals: true Testing Library не очищает DOM сама.
afterEach(cleanup);

// Тесты ходят в API через те же обработчики MSW, что и режим dev:mock.
// Запрос, для которого нет обработчика, — ошибка теста, а не выход в сеть.
beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  server.use(
    http.get('/config.json', () => HttpResponse.json({ apiBaseUrl: '/api', basemapUrl: null })),
  );
  await loadRuntimeConfig();
  server.resetHandlers();
  resetMockDb();
});

afterEach(() => {
  server.resetHandlers();
  resetMockDb();
});

afterAll(() => {
  server.close();
});

// Blob и File — из Node, а не из jsdom: перехватчик XHR в MSW не читает тело-jsdom-Blob
// (приходит строка «undefined»), а Request из Node его не принимает. Так файл, выбранный
// через user-event, доходит до обработчика MSW целиком, как в браузере.
vi.stubGlobal('Blob', NodeBlob);
vi.stubGlobal('File', NodeFile);

// В браузере new Request('/api/x') разрешается от адреса документа, в Node — падает.
// RTK Query создаёт Request сам, поэтому окружение приводится к поведению браузера.
const NodeRequest = globalThis.Request;
vi.stubGlobal(
  'Request',
  class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === 'string' ? new URL(input, location.href) : input, init);
    }
  },
);

installIntersectionObserver();

// jsdom не рисует на canvas и пишет в консоль «Not implemented» на каждый getContext.
// null — законный ответ браузера, код превью его обрабатывает.
// Свойство, а не vi.spyOn: restoreAllMocks в тестах иначе снял бы подмену.
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => null,
});

// jsdom не реализует scrollIntoView, а Combobox Mantine прокручивает к пункту при навигации
// стрелками.
Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });

// jsdom не реализует document.fonts, а Textarea с autosize подписывается на загрузку шрифтов.
Object.defineProperty(document, 'fonts', {
  configurable: true,
  value: { ready: Promise.resolve(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
});

// jsdom не реализует matchMedia и ResizeObserver, а Mantine их использует. Пользователь в тестах
// «просит уменьшить движение»: вместе с respectReducedMotion в тестовой теме это делает переходы
// Mantine мгновенными (см. shared/lib/test/index.tsx).
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: query.includes('prefers-reduced-motion: reduce'),
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  },
);

import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';

import { resetMockDb, server } from '@/shared/api/mocks/node';
import { loadRuntimeConfig } from '@/shared/config';

// Без globals: true Testing Library не очищает DOM сама.
afterEach(cleanup);

// Тесты ходят в API через те же обработчики MSW, что и режим dev:mock.
// Запрос, для которого нет обработчика, — ошибка теста, а не выход в сеть.
beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  server.use(http.get('/config.json', () => HttpResponse.json({ apiBaseUrl: '/api' })));
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

// jsdom не реализует matchMedia и ResizeObserver, а Mantine их использует.
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: false,
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

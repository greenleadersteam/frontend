import { setupWorker } from 'msw/browser';

import { resetMockDb } from './db';
import { handlers, rejectUnhandledApi } from './handlers';

export async function startMockWorker(): Promise<void> {
  resetMockDb();
  // Запросы вне /api — модули Vite, config.json, шрифты, подложка, воркер MapLibre — идут мимо
  // мока. Запрос к /api без обработчика обрывает rejectUnhandledApi: на моках он не должен уйти
  // на настоящий бэкенд.
  await setupWorker(...handlers, rejectUnhandledApi).start({ onUnhandledRequest: 'bypass' });
}

import { setupWorker } from 'msw/browser';

import { resetMockDb } from './db';
import { handlers } from './handlers';

export async function startMockWorker(): Promise<void> {
  resetMockDb();
  // Запросы вне /api — модули Vite, config.json, шрифты — идут мимо мока.
  await setupWorker(...handlers).start({ onUnhandledRequest: 'bypass' });
}

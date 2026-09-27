import { loadRuntimeConfig, RuntimeConfigError } from '@/shared/config';

const CONFIG_FAILED =
  'Не удалось загрузить настройки приложения. Обновите страницу. Если ошибка повторяется, сообщите администратору.';
const APP_FAILED =
  'Не удалось загрузить приложение. Обновите страницу. Если ошибка повторяется, сообщите администратору.';

// Экран без React: сюда попадаем, когда приложение не смогло стартовать.
// Техническую причину показываем только для ошибок конфига: их текст наш, без внутренних путей.
function showStartupError(reason: unknown): void {
  const message = document.createElement('p');
  const nodes: Node[] = [message];

  if (reason instanceof RuntimeConfigError) {
    message.textContent = CONFIG_FAILED;
    const details = document.createElement('small');
    details.textContent = reason.message;
    nodes.push(details);
  } else {
    message.textContent = APP_FAILED;
  }

  (document.getElementById('root') ?? document.body).replaceChildren(...nodes);
}

async function start(): Promise<void> {
  const container = document.getElementById('root');
  if (container === null) throw new Error('В index.html нет элемента #root');

  // Vite подставляет MODE строкой при сборке, поэтому вне режима mock условие ложно статически
  // и импорт моков вырезается из бандла.
  if (import.meta.env.MODE === 'mock') {
    const { startMockWorker } = await import('@/shared/api/mocks/browser');
    await startMockWorker();
  }

  await loadRuntimeConfig();
  const { renderApp } = await import('@/app');
  await renderApp(container);
}

start().catch(showStartupError);

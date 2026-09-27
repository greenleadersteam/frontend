import {
  currentDataSource,
  loadRuntimeConfig,
  RuntimeConfigError,
  switchDataSource,
  unregisterMockWorker,
} from '@/shared/config';

const CONFIG_FAILED =
  'Не удалось загрузить настройки приложения. Обновите страницу. Если ошибка повторяется, сообщите администратору.';
const APP_FAILED =
  'Не удалось загрузить приложение. Обновите страницу. Если ошибка повторяется, сообщите администратору.';
const DEMO_FAILED =
  'Не удалось запустить демонстрационные данные в этом браузере. Откройте приложение с данными сервера.';
const DEMO_EXIT = 'Открыть без демонстрационных данных';

// Выбор «Демо» сохранён в хранилище: если демо не стартует (например, браузер запретил
// Service Worker), перезагрузка повторила бы ошибку. Кнопка записывает выбор «Сервер».
let startingDemo = false;

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
  } else if (startingDemo) {
    message.textContent = DEMO_FAILED;
    const exit = document.createElement('button');
    exit.type = 'button';
    exit.textContent = DEMO_EXIT;
    exit.addEventListener('click', () => void switchDataSource('server'));
    nodes.push(exit);
  } else {
    message.textContent = APP_FAILED;
  }

  (document.getElementById('root') ?? document.body).replaceChildren(...nodes);
}

async function start(): Promise<void> {
  const container = document.getElementById('root');
  if (container === null) throw new Error('В index.html нет элемента #root');

  // Режим показа решается после конфига (demoMode — его поле) и до импорта приложения, чтобы
  // ни один запрос не ушёл мимо выбранного источника. Моки — отдельный ленивый чанк: в режиме
  // «Сервер» он не скачивается вовсе. Воркер, оставшийся от демо, снимается и при demoMode: off.
  await loadRuntimeConfig();
  if (currentDataSource() === 'demo') {
    startingDemo = true;
    const { startMockWorker } = await import('@/shared/api/mocks/browser');
    await startMockWorker();
  } else {
    await unregisterMockWorker();
  }

  const { renderApp } = await import('@/app');
  await renderApp(container);
}

start().catch(showStartupError);

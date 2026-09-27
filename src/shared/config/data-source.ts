// Источник данных в разработке: моки MSW в браузере или настоящий бэкенд через прокси Vite.
// Весь модуль используется только под import.meta.env.DEV и в production-сборку не попадает.
export type DataSource = 'mock' | 'server';

const STORAGE_KEY = 'greenleaders:data-source';
const URL_PARAM = 'data';
const MOCK_WORKER_SCRIPT = '/mockServiceWorker.js';

const isDataSource = (value: unknown): value is DataSource =>
  value === 'mock' || value === 'server';

type DataSourceInput = {
  search: string;
  stored: unknown;
  // import.meta.env.MODE: «mock» у npm run dev:mock.
  mode: string;
};

// Параметр адреса важнее сохранённого выбора: так делаются ссылки и скриншоты. Без выбора
// dev:mock открывается на моках, dev — на сервере.
export function resolveDataSource({ search, stored, mode }: DataSourceInput): DataSource {
  const fromUrl = new URLSearchParams(search).get(URL_PARAM);
  if (isDataSource(fromUrl)) return fromUrl;
  if (isDataSource(stored)) return stored;
  return mode === 'mock' ? 'mock' : 'server';
}

// Хранилище может быть недоступно (приватный режим, запрет сайта): тогда — умолчание.
function readStored(): unknown {
  try {
    // eslint-disable-next-line no-restricted-globals -- настройка разработчика, не токен и не данные
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let startupSource: DataSource | null = null;

// Источник решается один раз при старте, в main.tsx: MSW запущен или нет до перезагрузки.
// Параметр адреса теряется при первой навигации, поэтому повторно его не читаем — иначе
// переключатель показал бы не тот источник, на котором работает страница.
export function currentDataSource(): DataSource {
  startupSource ??= resolveDataSource({
    search: location.search,
    stored: readStored(),
    mode: import.meta.env.MODE,
  });
  return startupSource;
}

// Регистрация воркера MSW переживает перезагрузку: без неё страница на сервере осталась бы
// под управлением воркера моков.
export async function unregisterMockWorker(): Promise<void> {
  // Service Worker есть только в защищённом контексте: на http:// не с localhost регистраций
  // нет, и снимать нечего.
  if (!('serviceWorker' in navigator)) return;
  let registrations: readonly ServiceWorkerRegistration[];
  try {
    registrations = await navigator.serviceWorker.getRegistrations();
  } catch {
    // Хранилище сайта запрещено: регистраций быть не может.
    return;
  }
  await Promise.all(
    registrations
      .filter(({ active }) => active?.scriptURL.endsWith(MOCK_WORKER_SCRIPT) === true)
      .map((registration) => registration.unregister()),
  );
}

// Смена источника — полная перезагрузка: кэш RTK Query, опросы и загрузки начинаются заново.
// Параметр адреса перебил бы новый выбор, поэтому он убирается; без хранилища выбор
// переносится в него.
export async function switchDataSource(
  source: DataSource,
  reload: (href: string) => void = (href) => {
    location.replace(href);
  },
): Promise<void> {
  let saved = true;
  try {
    // eslint-disable-next-line no-restricted-globals -- настройка разработчика, не токен и не данные
    localStorage.setItem(STORAGE_KEY, source);
  } catch {
    saved = false;
  }
  if (source === 'server') await unregisterMockWorker();
  const url = new URL(location.href);
  if (saved) url.searchParams.delete(URL_PARAM);
  else url.searchParams.set(URL_PARAM, source);
  reload(url.href);
}

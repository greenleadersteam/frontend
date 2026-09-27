import { getRuntimeConfig, type RuntimeConfig } from './runtime-config';

// Источник данных: демонстрационные данные (моки MSW в браузере) или настоящий бэкенд.
// Демо — часть показа продукта: оно есть и в сборке, если конфиг контура его разрешает.
export type DataSource = 'demo' | 'server';

const STORAGE_KEY = 'greenleaders:data-source';
const URL_PARAM = 'data';
const MOCK_WORKER_SCRIPT = '/mockServiceWorker.js';

// «mock» — прежнее имя демо: старые ссылки и сохранённый выбор продолжают работать.
function parseDataSource(value: unknown): DataSource | null {
  if (value === 'demo' || value === 'mock') return 'demo';
  if (value === 'server') return 'server';
  return null;
}

type DataSourceInput = {
  search: string;
  stored: unknown;
  // import.meta.env.MODE: «mock» у npm run dev:mock.
  mode: string;
  demoMode: RuntimeConfig['demoMode'];
};

// Демо выключено в конфиге контура — только сервер, что бы ни было в адресе и хранилище.
// Иначе параметр адреса важнее сохранённого выбора: так делаются ссылки и скриншоты. Без выбора —
// сервер: жюри видит факт, демо включают осознанно; dev:mock открывается на демо.
export function resolveDataSource({ search, stored, mode, demoMode }: DataSourceInput): DataSource {
  if (demoMode === 'off') return 'server';
  return (
    parseDataSource(new URLSearchParams(search).get(URL_PARAM)) ??
    parseDataSource(stored) ??
    (mode === 'mock' ? 'demo' : 'server')
  );
}

// Хранилище может быть недоступно (приватный режим, запрет сайта): тогда — умолчание.
function readStored(): unknown {
  try {
    // eslint-disable-next-line no-restricted-globals -- выбор режима показа, не токен и не данные
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let startupSource: DataSource | null = null;

// Источник решается один раз при старте, в main.tsx после загрузки конфига: MSW запущен или
// нет до перезагрузки. Параметр адреса теряется при первой навигации, поэтому повторно его не
// читаем — иначе переключатель показал бы не тот источник, на котором работает страница.
export function currentDataSource(): DataSource {
  startupSource ??= resolveDataSource({
    search: location.search,
    stored: readStored(),
    mode: import.meta.env.MODE,
    demoMode: getRuntimeConfig().demoMode,
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
    // eslint-disable-next-line no-restricted-globals -- выбор режима показа, не токен и не данные
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

import { z } from 'zod';

const CONFIG_TIMEOUT_MS = 10_000;

// Сообщения этой ошибки пишем сами, поэтому их можно показать администратору как техническую причину.
export class RuntimeConfigError extends Error {
  override name = 'RuntimeConfigError';
}

// API всегда на своём origin (см. .claude/rules/security.md). Проверка через URL, а не по префиксу:
// «//host» и «/\host» начинаются с «/», но ведут на чужой origin.
const isSameOrigin = (value: string): boolean => {
  try {
    return new URL(value, location.origin).origin === location.origin;
  } catch {
    return false;
  }
};

const sameOriginPath = z
  .string()
  .startsWith('/')
  .refine(isSameOrigin, { message: 'должен быть путём на том же origin' });

// Адрес тайлов космоснимка — внешний сервис, поэтому только https и только шаблон XYZ, который
// понимает MapLibre. Проверка разбором URL, а не по префиксу (security.md).
const isHttps = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

const tileTemplate = z
  .string()
  .refine(isHttps, { message: 'должен быть адресом https://' })
  .refine((value) => value.includes('{z}/{y}/{x}'), {
    message: 'должен содержать шаблон {z}/{y}/{x}',
  });

// Космоснимок для модуля геопривязки. В контуре заказчика его нет (null): переключатель
// подложек показывает только «Схему». Условия и атрибуция — забота того, кто вписал источник.
const imagerySchema = z.strictObject({
  tilesUrl: tileTemplate,
  labelsUrl: tileTemplate,
  attribution: z.string().min(1),
});

export type ImageryConfig = z.infer<typeof imagerySchema>;

// Геокодер для поиска по адресу (API Nominatim: /search с format=jsonv2). Внешний сервис, поэтому
// только https; хост должен быть в connect-src CSP контура. Без него (null) поиск понимает только
// координаты.
const geocoderSchema = z.strictObject({
  url: z.string().refine(isHttps, { message: 'должен быть адресом https://' }),
  attribution: z.string().min(1),
});

export type GeocoderConfig = z.infer<typeof geocoderSchema>;

// Что сервер умеет сверх базового API (контракт-предложение). Фронт не угадывает это по 404,
// а читает явный список из конфига контура.
export const CAPABILITIES = [
  'obstacles',
  'rejected',
  'norms',
  'explanationChecks',
  'species',
  'plantingEdits',
  'editedDxf',
  'runs',
  'manualGeoreference',
  'optionalBbox',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const isCapability = (value: string): value is Capability =>
  (CAPABILITIES as readonly string[]).includes(value);

// Конфиг контура может опережать сборку: неизвестная возможность — предупреждение, а не
// экран ошибки, иначе новый сервер сломал бы старый фронт.
const capabilities = z
  .array(z.string())
  .default([])
  .transform((values) => {
    const unknown = values.filter((value) => !isCapability(value));
    if (unknown.length > 0) {
      // eslint-disable-next-line no-console -- предупреждение администратору контура, не лог приложения
      console.warn(`/config.json: неизвестные serverCapabilities пропущены: ${unknown.join(', ')}`);
    }
    return values.filter(isCapability);
  });

// strictObject: опечатка в имени поля конфига контура должна быть ошибкой, а не молча игнорироваться.
const runtimeConfigSchema = z.strictObject({
  apiBaseUrl: sameOriginPath,
  // Архив подложки PMTiles; null — карта без подложки.
  basemapUrl: sameOriginPath.nullable(),
  // Без поля — снимка нет: внешний источник включают только явно.
  imagery: imagerySchema.nullable().default(null),
  // Без поля — адресного поиска нет: внешний сервис включают только явно.
  geocoder: geocoderSchema.nullable().default(null),
  // Демо на моках для показа. Без поля — выключено: контур заказчика получает демо, только
  // если его явно включили, и может выключить без пересборки образа.
  demoMode: z.enum(['available', 'off']).default('off'),
  serverCapabilities: capabilities,
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

let runtimeConfig: RuntimeConfig | null = null;

async function requestConfig(): Promise<Response> {
  try {
    return await fetch('/config.json', {
      cache: 'no-store',
      signal: AbortSignal.timeout(CONFIG_TIMEOUT_MS),
    });
  } catch {
    throw new RuntimeConfigError(
      `/config.json: нет ответа (сеть недоступна или прошло ${String(CONFIG_TIMEOUT_MS / 1000)} с)`,
    );
  }
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await requestConfig();
  if (!response.ok) {
    throw new RuntimeConfigError(`/config.json: HTTP ${String(response.status)}`);
  }
  // Если файла нет, dev-сервер и SPA-fallback nginx отвечают index.html с кодом 200.
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new RuntimeConfigError(
      `/config.json: ожидался JSON, получен «${contentType || 'без Content-Type'}»`,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new RuntimeConfigError('/config.json: некорректный JSON');
  }
  const result = runtimeConfigSchema.safeParse(body);
  if (!result.success) {
    throw new RuntimeConfigError(`/config.json: ${z.prettifyError(result.error)}`);
  }
  runtimeConfig = result.data;
  return runtimeConfig;
}

export function getRuntimeConfig(): RuntimeConfig {
  if (runtimeConfig === null) {
    throw new Error('Runtime-конфиг запрошен до loadRuntimeConfig()');
  }
  return runtimeConfig;
}

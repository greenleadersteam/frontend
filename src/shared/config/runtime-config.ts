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

// strictObject: опечатка в имени поля конфига контура должна быть ошибкой, а не молча игнорироваться.
const runtimeConfigSchema = z.strictObject({
  apiBaseUrl: z
    .string()
    .startsWith('/')
    .refine(isSameOrigin, { message: 'должен быть путём на том же origin' }),
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

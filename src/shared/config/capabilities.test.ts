import { beforeEach, describe, expect, test, vi } from 'vitest';

import { CAPABILITIES, type Capability } from './runtime-config';

const mode = vi.hoisted(() => ({
  source: 'server',
  capabilities: [] as Capability[],
}));

vi.mock('./data-source', () => ({ currentDataSource: () => mode.source }));
vi.mock('./runtime-config', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getRuntimeConfig: () => ({ serverCapabilities: mode.capabilities }),
}));

// Общая настройка тестов уже загрузила настоящий конфиг: хук берётся свежим, с подменами.
const enabled = async () => {
  vi.resetModules();
  const { useCapability } = await import('./capabilities');
  return CAPABILITIES.filter((name) => useCapability(name));
};

beforeEach(() => {
  mode.source = 'server';
  mode.capabilities = [];
});

describe('useCapability', () => {
  test('сервер без объявленных возможностей не умеет ничего сверх базового API', async () => {
    expect(await enabled()).toEqual([]);
  });

  test('сервер умеет ровно то, что объявлено в конфиге', async () => {
    mode.capabilities = ['runs', 'norms'];

    expect(await enabled()).toEqual(['norms', 'runs']);
  });

  test('в «Демо» включены все возможности, что бы ни было в конфиге', async () => {
    mode.source = 'demo';

    expect(await enabled()).toEqual(CAPABILITIES);
  });
});

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type * as Config from '@/shared/config';
import { renderWithProviders } from '@/shared/lib/test';

import { AppHeader } from './app-header';

const mode = vi.hoisted(() => ({
  demoMode: 'available',
  source: 'server',
  switch: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/shared/config', async (importOriginal) => {
  const original = await importOriginal<typeof Config>();
  return {
    ...original,
    getRuntimeConfig: () => ({ ...original.getRuntimeConfig(), demoMode: mode.demoMode }),
    currentDataSource: () => mode.source,
    switchDataSource: mode.switch,
  };
});

const renderHeader = () => renderWithProviders([{ path: '/', element: <AppHeader /> }], '/');

beforeEach(() => {
  mode.demoMode = 'available';
  mode.source = 'server';
  mode.switch.mockClear();
});

describe('AppHeader и режим показа', () => {
  test('демо выключено в конфиге — переключателя и метки нет', async () => {
    mode.demoMode = 'off';
    renderHeader();

    expect(await screen.findByRole('link', { name: 'Проекты' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Источник данных' })).not.toBeInTheDocument();
    expect(screen.queryByText('Демонстрационные данные')).not.toBeInTheDocument();
  });

  test('«Сервер» — переключатель есть, метки демо нет', async () => {
    renderHeader();

    expect(await screen.findByRole('radiogroup', { name: 'Источник данных' })).toBeInTheDocument();
    expect(screen.queryByText('Демонстрационные данные')).not.toBeInTheDocument();
  });

  test('«Демо» — постоянная метка, объявляется живой областью и ведёт к серверу', async () => {
    mode.source = 'demo';
    renderHeader();

    expect(await screen.findByRole('status')).toHaveTextContent('Демонстрационные данные');
    expect(screen.queryByRole('button', { name: /закрыть/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Перейти к серверу' }));
    expect(mode.switch).toHaveBeenCalledWith('server');
  });

  test('метка объявляется один раз за загрузку: при повторном монтировании текст есть сразу', async () => {
    mode.source = 'demo';
    const first = renderHeader();
    expect(await screen.findByRole('status')).toHaveTextContent('Демонстрационные данные');
    first.unmount();

    // Переход между макетами списка и проекта монтирует шапку заново: живая область уже
    // содержит текст с первого рендера и изменения для объявления не получает.
    renderHeader();
    expect(screen.getByRole('status')).toHaveTextContent('Демонстрационные данные');
  });
});

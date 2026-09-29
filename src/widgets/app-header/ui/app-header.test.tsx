import { screen, within } from '@testing-library/react';
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

describe('AppHeader: название продукта', () => {
  test('на широком экране рядом с названием — подпись команды', async () => {
    const wide = vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query === '(min-width: 64em)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    renderHeader();

    expect(await screen.findByRole('link', { name: /^Московские посадки/ })).toContainElement(
      screen.getByText('by Green Leaders'),
    );
    wide.mockRestore();
  });

  test('на узком экране подписи команды нет', async () => {
    renderHeader();

    // Имя ссылки — alt знака, видимое название читалке не повторяется.
    const brand = await screen.findByRole('link', { name: 'Московские посадки' });
    expect(within(brand).getByRole('img', { name: 'Московские посадки' })).toBeInTheDocument();
    expect(screen.queryByText('by Green Leaders')).not.toBeInTheDocument();
  });
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

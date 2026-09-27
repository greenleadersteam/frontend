import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type * as Config from '@/shared/config';
import { renderWithTheme } from '@/shared/lib/test';

import { DataSourceSwitch } from './data-source-switch';

const dataSource = vi.hoisted(() => ({ current: 'mock', switch: vi.fn() }));

vi.mock('@/shared/config', async (importOriginal) => ({
  ...(await importOriginal<typeof Config>()),
  currentDataSource: () => dataSource.current,
  switchDataSource: dataSource.switch,
}));

beforeEach(() => {
  dataSource.switch.mockReset();
});

describe('DataSourceSwitch', () => {
  test.each([
    [
      'mock',
      'Моки',
      'Демонстрационные данные в браузере. Перезагрузка страницы сбрасывает изменения',
    ],
    // Хост — из конфига прокси (API_PROXY_TARGET может быть задан локально).
    ['server', 'Сервер', `Данные с ${__API_PROXY_HOST__} через прокси`],
  ] as const)('режим %s: выбран «%s», подсказка', async (source, label, hint) => {
    dataSource.current = source;
    renderWithTheme(<DataSourceSwitch />);

    const group = screen.getByRole('radiogroup', { name: 'Источник данных' });
    expect(screen.getByRole('radio', { name: label })).toBeChecked();
    expect(group.closest('[data-source]')).toHaveAttribute('data-source', source);

    await userEvent.hover(screen.getByRole('radio', { name: label }));
    expect(await screen.findByText(hint)).toBeInTheDocument();
  });

  test('выбор другого источника записывает его и перезагружает страницу', async () => {
    dataSource.current = 'mock';
    renderWithTheme(<DataSourceSwitch />);

    await userEvent.click(screen.getByRole('radio', { name: 'Сервер' }));

    expect(dataSource.switch).toHaveBeenCalledWith('server');
  });

  test('переключение с клавиатуры', async () => {
    dataSource.current = 'server';
    renderWithTheme(<DataSourceSwitch />);

    screen.getByRole('radio', { name: 'Сервер' }).focus();
    await userEvent.keyboard('{ArrowLeft}');

    expect(dataSource.switch).toHaveBeenCalledWith('mock');
  });
});

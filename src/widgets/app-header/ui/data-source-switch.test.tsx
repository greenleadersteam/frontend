import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type * as Config from '@/shared/config';
import { renderWithTheme } from '@/shared/lib/test';

import { DataSourceSwitch } from './data-source-switch';

const dataSource = vi.hoisted(() => ({ current: 'demo', switch: vi.fn() }));

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
      'demo',
      'Демо',
      'Все данные демонстрационные: проекты, обработка и результат работают в браузере без сервера. Изменения хранятся до перезагрузки страницы.',
    ],
    ['server', 'Сервер', 'Данные и расчёты сервера обработки'],
  ] as const)('режим %s: выбран «%s», подсказка', async (source, label, hint) => {
    dataSource.current = source;
    renderWithTheme(<DataSourceSwitch />);

    const group = screen.getByRole('radiogroup', { name: 'Источник данных' });
    expect(screen.getByRole('radio', { name: label })).toBeChecked();
    expect(group.closest('[data-source]')).toHaveAttribute('data-source', source);

    await userEvent.hover(screen.getByRole('radio', { name: label }));
    expect(await screen.findByText(hint)).toBeInTheDocument();
  });

  test('жаргона разработки нет: «Моки» нигде не видно', () => {
    renderWithTheme(<DataSourceSwitch />);

    expect(screen.queryByText(/мок/i)).not.toBeInTheDocument();
  });

  test('выбор другого источника записывает его и перезагружает страницу', async () => {
    dataSource.current = 'demo';
    renderWithTheme(<DataSourceSwitch />);

    await userEvent.click(screen.getByRole('radio', { name: 'Сервер' }));

    expect(dataSource.switch).toHaveBeenCalledWith('server');
  });

  test('переключение с клавиатуры', async () => {
    dataSource.current = 'server';
    renderWithTheme(<DataSourceSwitch />);

    screen.getByRole('radio', { name: 'Сервер' }).focus();
    await userEvent.keyboard('{ArrowRight}');

    expect(dataSource.switch).toHaveBeenCalledWith('demo');
  });
});

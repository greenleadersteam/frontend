import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type * as Config from '@/shared/config';
import { renderWithProviders } from '@/shared/lib/test';

import { ProjectNotFound } from './project-not-found';

const mode = vi.hoisted(() => ({
  demoMode: 'available',
  source: 'demo',
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

const renderScreen = () =>
  renderWithProviders(
    [{ path: '/projects/:projectId', element: <ProjectNotFound /> }],
    '/projects/x',
  );

beforeEach(() => {
  mode.demoMode = 'available';
  mode.switch.mockClear();
});

describe('проекта нет в текущем режиме', () => {
  test('в «Демо» — проект сервера: открыть его в «Сервере» на том же адресе или к демо-проектам', async () => {
    mode.source = 'demo';
    renderScreen();

    expect(
      await screen.findByText('В режиме «Демо» такого проекта нет — это проект сервера.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'К демо-проектам' })).toHaveAttribute('href', '/');
    await userEvent.click(screen.getByRole('button', { name: 'Открыть в режиме «Сервер»' }));
    expect(mode.switch).toHaveBeenCalledWith('server', undefined, true);
  });

  test('на «Сервере» — возможно, демо-проект: открыть в «Демо» или к проектам сервера', async () => {
    mode.source = 'server';
    renderScreen();

    expect(
      await screen.findByText('На сервере такого проекта нет — возможно, это демо-проект.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'К проектам сервера' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Открыть в режиме «Демо»' }));
    expect(mode.switch).toHaveBeenCalledWith('demo', undefined, true);
  });

  test('«Демо» выключено в конфиге — обычная страница «не найдено»', async () => {
    mode.demoMode = 'off';
    renderScreen();

    expect(await screen.findByRole('heading', { name: 'Страница не найдена' })).toBeInTheDocument();
  });
});

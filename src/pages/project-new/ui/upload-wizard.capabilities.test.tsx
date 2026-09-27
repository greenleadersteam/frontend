import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import type * as Config from '@/shared/config';
import { buildZip, renderWithProviders } from '@/shared/lib/test';

import { ProjectNewPage } from './project-new-page';

// Сервер без optionalBbox: как задеплоенный бэкенд, который требует bbox_user.
vi.mock('@/shared/config', async (importOriginal) => ({
  ...(await importOriginal<typeof Config>()),
  useCapability: (name: string) => name !== 'optionalBbox',
}));

const DRAFT_ID = '9a1c3e5b7d2f4a6c8e0b2d4f6a8c1e3b';
const REASON =
  'Сервер не принимает проект без области участка, а задать её в мастере нельзя. Архив можно загрузить в черновик, созданный раньше, — из списка проектов.';

const renderWizard = (path: string) =>
  renderWithProviders([{ path: '/projects/new', Component: ProjectNewPage }], path);

const chooseArchive = async () => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error('Нет поля выбора файла');
  const entries = [{ name: 'ГП/Генплан.dxf', data: '0\nSECTION' }];
  await userEvent.upload(input, new File([buildZip(entries)], 'site.zip'));
};

test('новый проект: создание заблокировано на первом шаге, с объяснением', async () => {
  renderWizard('/projects/new');

  const next = await screen.findByRole('button', { name: 'Далее: файлы' });
  expect(next).toBeDisabled();
  expect(next).toHaveAccessibleDescription(REASON);
});

test('черновик из списка уже создан — загрузка в него доступна', async () => {
  renderWizard(`/projects/new?project=${DRAFT_ID}`);
  await screen.findByRole('heading', { level: 1 });
  await chooseArchive();

  expect(await screen.findByRole('button', { name: 'Загрузить и обработать' })).toBeEnabled();
  expect(screen.queryByText(REASON)).not.toBeInTheDocument();
});

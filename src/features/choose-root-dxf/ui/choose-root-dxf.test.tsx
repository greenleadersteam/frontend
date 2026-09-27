import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, test } from 'vitest';

import { renderWithProviders, server } from '@/shared/lib/test';

import { ChooseRootDxf } from './choose-root-dxf';

const AMBIGUOUS_ID = 'd1f3b5d7e9a14e2c4b6d8f0a2c4e6b8d';
const CANDIDATES = ['ГП/Генплан.dxf', 'ГП/Генплан_изм2.dxf'];

const renderChoice = () =>
  renderWithProviders(
    [
      {
        path: '/',
        element: (
          <ChooseRootDxf
            projectId={AMBIGUOUS_ID}
            candidates={CANDIDATES}
            uploadAnother={(variant) => (
              <a href="/projects/new" data-variant={variant}>
                Загрузить другой архив
              </a>
            )}
          />
        ),
      },
    ],
    '/',
  );

const runsRespond = (status: number) => {
  server.use(
    http.post('/api/projects/:projectId/runs', () =>
      HttpResponse.json({ detail: 'Not Found' }, { status }),
    ),
  );
};

const choose = async () => {
  await userEvent.click(await screen.findByRole('radio', { name: 'ГП/Генплан.dxf' }));
  await userEvent.click(screen.getByRole('button', { name: 'Продолжить обработку' }));
};

describe('ChooseRootDxf', () => {
  // Бэкенд может ещё не уметь /runs: тогда выбор бессмыслен, остаётся новый архив.
  test.each([404, 405])(
    '/runs ответил %i — объяснение, кандидаты и новый архив',
    async (status) => {
      runsRespond(status);
      renderChoice();

      await choose();

      const explanation = await screen.findByText(
        'Сервер пока не умеет выбирать чертёж. Оставьте в архиве один главный чертёж и загрузите архив снова.',
      );
      expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(CANDIDATES);
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Загрузить другой архив' })).toHaveAttribute(
        'data-variant',
        'filled',
      );
      expect(explanation).toHaveFocus();
    },
  );

  test('другая ошибка /runs — текст ошибки, выбор остаётся', async () => {
    runsRespond(500);
    renderChoice();

    await choose();

    expect(await screen.findByRole('alert')).toHaveTextContent(/Сервер не смог обработать запрос/);
    expect(screen.getByRole('radio', { name: 'ГП/Генплан.dxf' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Продолжить обработку' })).toBeInTheDocument();
  });
});

import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { PageLoader } from './page-loader';

test('загрузка страницы — живая область с подписью для экранного диктора', () => {
  render(
    <MantineProvider>
      <PageLoader />
    </MantineProvider>,
  );

  const status = screen.getByRole('status');
  expect(status).toHaveAttribute('aria-live', 'polite');
  expect(status).toHaveTextContent('Загружаем…');
});

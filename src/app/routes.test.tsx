import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { renderWithProviders } from '@/shared/lib/test';

import { routes } from './routes';

const headingAt = async (path: string) => {
  renderWithProviders(routes, path);
  return screen.findByRole('heading', { level: 1 });
};

describe('маршруты', () => {
  test('/ показывает список проектов', async () => {
    expect(await headingAt('/')).toHaveTextContent('Проекты');
  });

  test('/projects/new показывает мастер загрузки', async () => {
    expect(await headingAt('/projects/new')).toHaveTextContent('Новый проект');
  });

  test('корректный projectId показывает проект', async () => {
    expect(await headingAt('/projects/9a1c3e5b7d2f4a6c8e0b2d4f6a8c1e3b')).toHaveTextContent(
      'Улица Маросейка, 7–9',
    );
  });

  test('неизвестный путь показывает «Страница не найдена»', async () => {
    expect(await headingAt('/unknown/path')).toHaveTextContent('Страница не найдена');
  });

  test.each([
    ['кириллица', '/projects/%D0%BF%D1%80%D0%BE%D0%B5%D0%BA%D1%82'],
    ['пробел', '/projects/a%20b'],
    ['129 символов', `/projects/${'a'.repeat(129)}`],
  ])('некорректный projectId (%s) показывает «Страница не найдена»', async (_, path) => {
    expect(await headingAt(path)).toHaveTextContent('Страница не найдена');
  });
});

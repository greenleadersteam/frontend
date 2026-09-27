import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { RouteObject } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { FOCUS_PROJECTS_HEADING } from '@/shared/config';
import { enterViewport, renderWithProviders, resetMockDb, server } from '@/shared/lib/test';

import { ProjectsPage } from './projects-page';

const routes: RouteObject[] = [
  { path: '/', Component: ProjectsPage },
  { path: '/projects/:projectId', element: <h1>Страница проекта</h1> },
];

const renderPage = () => renderWithProviders(routes, '/');

// getByText сводит пробелы в тексте DOM к обычным (U+00A0 тоже), а строку-ожидание не трогает,
// поэтому в ожиданиях между числом и единицей стоит обычный пробел.

const cardOf = async (name: string) => {
  const heading = await screen.findByRole('heading', { name });
  const card = heading.closest('article');
  if (card === null) throw new Error(`Нет карточки «${name}»`);
  return within(card);
};

const project = (id: string, name: string, updatedAt: string) => ({
  id,
  name,
  description: null,
  created_at: '2026-01-10T10:00:00Z',
  updated_at: updatedAt,
  status: 'draft',
  job: { stage: 'draft', progress_pct: 0 },
});

afterEach(() => {
  server.events.removeAllListeners();
  vi.useRealTimers();
});

describe('состояния страницы', () => {
  test('загрузка — скелетоны карточек', () => {
    renderPage();

    expect(screen.getByLabelText('Загрузка проектов')).toHaveAttribute('aria-busy', 'true');
  });

  test('данные — карточки, счётчик и сортировка по изменению, новые сверху', async () => {
    server.use(
      http.get('/api/projects', () =>
        HttpResponse.json([
          project('old', 'Улица Бахрушина, 11', '2026-03-01T10:00:00Z'),
          project('new', 'Сквер на Покровке', '2026-09-20T10:00:00Z'),
        ]),
      ),
    );
    renderPage();

    const cards = await screen.findAllByRole('article');
    expect(cards.map((card) => within(card).getByRole('heading').textContent)).toEqual([
      'Сквер на Покровке',
      'Улица Бахрушина, 11',
    ]);
    expect(screen.getByText('2 проекта')).toBeInTheDocument();
  });

  test('данные моков — 11 проектов', async () => {
    renderPage();

    expect(await screen.findAllByRole('article')).toHaveLength(11);
    expect(screen.getByText('11 проектов')).toBeInTheDocument();
  });

  test('пусто — пустое состояние с действием', async () => {
    server.use(http.get('/api/projects', () => HttpResponse.json([])));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Проектов пока нет' })).toBeInTheDocument();
    // Главное действие одно на экран: кнопка в заголовке в пустом состоянии скрыта.
    expect(screen.getAllByRole('link', { name: 'Загрузить проект' })).toHaveLength(1);
  });

  test('ошибка — сообщение и повтор запроса', async () => {
    server.use(http.get('/api/projects', () => new HttpResponse(null, { status: 500 })));
    renderPage();

    expect(await screen.findByText(/Сервер не смог обработать запрос/)).toBeInTheDocument();
    server.resetHandlers();
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findAllByRole('article')).toHaveLength(11);
  });
});

test('сбой фонового обновления — предупреждение, повтор снимает его', async () => {
  renderPage();
  await screen.findAllByRole('article');
  server.use(http.get('/api/projects', () => new HttpResponse(null, { status: 500 })));

  // Список опрашивается раз в 2 с, пока в нём есть проекты в обработке.
  expect(
    await screen.findByText(/^Не удалось обновить статусы/, {}, { timeout: 5000 }),
  ).toBeInTheDocument();
  expect(screen.getAllByRole('article')).toHaveLength(11);

  server.resetHandlers();
  await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  await waitFor(() => {
    expect(screen.queryByText(/^Не удалось обновить статусы/)).not.toBeInTheDocument();
  });
});

describe('карточка', () => {
  test('готовый проект — бейдж, длительность без очереди, дата изменения', async () => {
    renderPage();
    const card = await cardOf('Сквер на Покровке');

    expect(card.getByText('Готово')).toBeInTheDocument();
    expect(card.getByText('за 19 с')).toBeInTheDocument();
    expect(card.getByText(/^изменён \d{1,2} [а-я]+$/)).toBeInTheDocument();
  });

  test('идёт обработка — этап и процент в бейдже, без длительности', async () => {
    // Проекты мока в обработке продвигаются со временем: время замораживается на момент засева.
    vi.useFakeTimers({ toFake: ['Date'] });
    resetMockDb();
    renderPage();
    const card = await cardOf('Чистопрудный бульвар, участок 2');

    expect(card.getByText('Разбор подосновы')).toBeInTheDocument();
    expect(card.getByText('10 %')).toBeInTheDocument();
    expect(card.queryByText(/^за /)).not.toBeInTheDocument();
  });

  test('архив не загружен — описание вместо ошибки', async () => {
    renderPage();
    const card = await cardOf('Улица Маросейка, 7–9');

    expect(card.getByText('Архив не загружен')).toBeInTheDocument();
    expect(card.getByText('Демонстрационный проект. Озеленение тротуара')).toBeInTheDocument();
  });

  test.each([
    ['Улица Большая Ордынка, 21', 'Архив повреждён или это не ZIP.'],
    ['Сквер на Новослободской', 'В архиве несколько главных чертежей. Выберите нужный.'],
  ])('ошибка обработки «%s» — строка «что случилось и что делать»', async (name, text) => {
    renderPage();
    const card = await cardOf(name);

    expect(card.getByText('Ошибка обработки')).toBeInTheDocument();
    expect(card.getByText(new RegExp(`^${text.replace('.', '\\.')}`))).toBeInTheDocument();
  });

  test('растянутая ссылка на названии ведёт на проект', async () => {
    renderPage();
    const card = await cardOf('Сквер на Покровке');

    await userEvent.click(card.getByRole('link', { name: 'Сквер на Покровке' }));

    expect(await screen.findByRole('heading', { name: 'Страница проекта' })).toBeInTheDocument();
  });

  test('кнопка меню открывает меню и не ведёт на проект', async () => {
    renderPage();
    const card = await cardOf('Сквер на Покровке');

    await userEvent.click(card.getByRole('button', { name: 'Действия с проектом' }));

    expect(await screen.findByRole('menuitem', { name: 'Удалить проект' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Проекты' })).toBeInTheDocument();
  });
});

describe('удаление', () => {
  const openDeleteDialog = async (name: string) => {
    const card = await cardOf(name);
    await userEvent.click(card.getByRole('button', { name: 'Действия с проектом' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Удалить проект' }));
    return screen.findByRole('dialog', { name: 'Удалить проект?' });
  };

  test('переход после удаления с экрана проекта — фокус на заголовке списка', async () => {
    renderWithProviders(routes, { pathname: '/', state: FOCUS_PROJECTS_HEADING });

    const heading = await screen.findByRole('heading', { level: 1, name: 'Проекты' });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
  });

  test('обычный переход к списку фокус не трогает', async () => {
    renderPage();

    const heading = await screen.findByRole('heading', { level: 1, name: 'Проекты' });
    expect(heading).not.toHaveFocus();
  });

  test('подтверждение, загрузка, уведомление и обновление списка', async () => {
    // Запрос держится «воротами», пока тест проверяет состояние загрузки; обработчик ничего
    // не возвращает, поэтому затем запрос уходит дальше — в мок-базу, которая удаляет проект.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.delete('/api/projects/:projectId', async () => {
        await gate;
      }),
    );
    renderPage();
    const dialog = within(await openDeleteDialog('Сквер на Покровке'));

    expect(
      dialog.getByText(/^Проект «Сквер на Покровке» и результаты обработки будут удалены/),
    ).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => {
      expect(dialog.getByRole('button', { name: 'Удалить' })).toHaveAttribute('data-loading');
    });
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Удалить проект?' })).toBeInTheDocument();

    act(() => {
      release();
    });

    expect(await screen.findByText('Проект удалён')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Сквер на Покровке' })).not.toBeInTheDocument();
    });
    expect(screen.getByText('10 проектов')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Проекты' })).toHaveFocus();
  });

  test('ошибка удаления — окно остаётся открытым, причина под текстом', async () => {
    server.use(
      http.delete('/api/projects/:projectId', () => new HttpResponse(null, { status: 500 })),
    );
    renderPage();
    const dialog = within(await openDeleteDialog('Сквер на Покровке'));

    await userEvent.click(dialog.getByRole('button', { name: 'Удалить' }));

    expect(await dialog.findByText(/Сервер не смог обработать запрос/)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Удалить проект?' })).toBeInTheDocument();
  });

  test('во время обработки пункт неактивен и объясняет почему', async () => {
    renderPage();
    const card = await cardOf('Чистопрудный бульвар, участок 2');

    await userEvent.click(card.getByRole('button', { name: 'Действия с проектом' }));

    expect(await screen.findByRole('menuitem', { name: 'Удалить проект' })).toBeDisabled();
    expect(screen.getByText('Удалить можно после завершения обработки')).toBeInTheDocument();
  });
});

describe('опрос', () => {
  test('проект в обработке доходит до «Готово», после чего опрос останавливается', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    resetMockDb();
    let listRequests = 0;
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'GET' && new URL(request.url).pathname === '/api/projects') {
        listRequests += 1;
      }
    });
    renderPage();
    // findBy* ждёт на setTimeout, который здесь поддельный, поэтому ожидание — через vi.waitFor.
    const heading = await act(() =>
      vi.waitFor(() => screen.getByRole('heading', { name: 'Чистопрудный бульвар, участок 2' })),
    );
    const article = heading.closest('article');
    if (article === null) throw new Error('Нет карточки');
    const card = within(article);
    expect(card.getByText('Разбор подосновы')).toBeInTheDocument();

    for (let second = 0; second < 20; second += 2) {
      await act(() => vi.advanceTimersByTimeAsync(2000));
    }

    expect(card.getByText('Готово')).toBeInTheDocument();
    const afterReady = listRequests;
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(listRequests).toBe(afterReady);
  });
});

describe('превью', () => {
  const resultRequests = () => {
    const paths: string[] = [];
    server.events.on('request:start', ({ request }) => {
      const { pathname } = new URL(request.url);
      if (/\/(planting|zones)$/.test(pathname)) paths.push(pathname);
    });
    return paths;
  };

  test('план готового проекта запрашивается только после появления в области видимости', async () => {
    const requested = resultRequests();
    renderPage();
    await screen.findAllByRole('article');

    expect(requested).toEqual([]);
    act(() => {
      enterViewport();
    });

    await waitFor(() => {
      expect(new Set(requested)).toEqual(
        new Set([
          '/api/projects/5c0b7f2e9a3d4e61b8f0c2a7d9e4b1f3/planting',
          '/api/projects/5c0b7f2e9a3d4e61b8f0c2a7d9e4b1f3/zones',
          '/api/projects/0e8d2b6a4c1f47e9a3b5d7c9e1f2a4b6/planting',
          '/api/projects/0e8d2b6a4c1f47e9a3b5d7c9e1f2a4b6/zones',
        ]),
      );
    });
  });
});

describe('меню карточки', () => {
  // Для ambiguous_root_dxf вместо нового архива — выбор главного чертежа в том же мастере.
  test.each([
    ['Улица Маросейка, 7–9', 'Загрузить архив'],
    ['Улица Большая Ордынка, 21', 'Загрузить архив'],
    ['Сквер на Новослободской', 'Выбрать главный чертёж'],
    ['Сквер на Покровке', null],
  ])('«%s» — пункт %s', async (name, shown) => {
    renderPage();
    const card = await cardOf(name);

    await userEvent.click(card.getByRole('button', { name: 'Действия с проектом' }));
    await screen.findByRole('menuitem', { name: 'Удалить проект' });

    for (const label of ['Загрузить архив', 'Выбрать главный чертёж']) {
      const item = screen.queryByRole('menuitem', { name: label });
      if (label === shown) {
        expect(item).toHaveAttribute(
          'href',
          expect.stringMatching(/^\/projects\/new\?project=[0-9a-f]{32}$/),
        );
      } else {
        expect(item).not.toBeInTheDocument();
      }
    }
  });

  // Сценарий идёт около 4 с при пределе 5 с: под нагрузкой он выходил за предел, а продолжение
  // прерванного теста роняло следующие тесты «меню карточки».
  test.each([
    ['zoning_layout', 'Обработка идёт больше 30 минут.'],
    ['queued', 'Проект ждёт в очереди больше 30 минут.'],
  ])(
    'зависший проект (%s) можно удалить после срабатывания предохранителя',
    async (stage, text) => {
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
      });
      server.use(
        http.get('/api/projects', () =>
          HttpResponse.json([
            {
              ...project('stuck', 'Сквер на Трубной площади', '2026-09-20T10:00:00Z'),
              status: stage,
              job: { stage, progress_pct: 0, started_at: '2026-01-10T10:00:00Z' },
            },
          ]),
        ),
      );
      renderPage();
      await act(() =>
        vi.waitFor(() => screen.getByRole('heading', { name: 'Сквер на Трубной площади' })),
      );

      // Предохранитель опроса — 30 минут (api.md).
      await act(() => vi.advanceTimersByTimeAsync(30 * 60 * 1000));
      // Опрос остановлен предохранителем — дальше обычное время.
      vi.useRealTimers();
      await userEvent.click(screen.getByRole('button', { name: 'Действия с проектом' }));
      const item = await screen.findByRole('menuitem', { name: 'Удалить проект' });
      expect(item).toBeEnabled();

      await userEvent.click(item);
      const dialog = await screen.findByRole('dialog', { name: 'Удалить проект?' });
      expect(dialog).toHaveTextContent(text);
      expect(dialog).not.toHaveTextContent(/прерван/);
    },
    15_000,
  );

  test('после срабатывания предохранителя недавняя обработка удалению по-прежнему закрыта', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    const startedAt = new Date(Date.now() + 29 * 60 * 1000).toISOString();
    server.use(
      http.get('/api/projects', () =>
        HttpResponse.json([
          {
            ...project('young', 'Сквер у Рогожской заставы', '2026-09-20T10:00:00Z'),
            status: 'queued',
            job: { stage: 'queued', progress_pct: 0, started_at: startedAt },
          },
        ]),
      ),
    );
    renderPage();
    await act(() =>
      vi.waitFor(() => screen.getByRole('heading', { name: 'Сквер у Рогожской заставы' })),
    );
    await act(() => vi.advanceTimersByTimeAsync(30 * 60 * 1000));
    vi.useRealTimers();

    await userEvent.click(screen.getByRole('button', { name: 'Действия с проектом' }));

    expect(await screen.findByRole('menuitem', { name: 'Удалить проект' })).toBeDisabled();
  });
});

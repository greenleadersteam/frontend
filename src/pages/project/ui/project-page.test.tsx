import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { type ReactNode, useEffect } from 'react';
import { type RouteObject, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { FOCUS_PROJECTS_HEADING } from '@/shared/config';
import { renderWithProviders, server } from '@/shared/lib/test';

import { ProjectPage } from './project-page';

// Карта в jsdom не рисуется: модуль карты подменяется на границе ленивого импорта.
// Подмена отдаёт экрану объект с теми методами MapLibre, которыми экран пользуется.
type Handler = (event: { point: { x: number; y: number } }) => void;

const mapMock = vi.hoisted(() => ({ unavailable: false }));

function createFakeMap() {
  const handlers = new Map<string, Handler>();
  const canvas = { style: { cursor: '' }, focus: vi.fn() };
  return {
    handlers,
    canvas,
    getPixelRatio: () => 1,
    addImage: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    on: vi.fn((event: string, layerOrHandler: string | Handler, handler?: Handler) => {
      if (typeof layerOrHandler === 'function') handlers.set(event, layerOrHandler);
      else if (handler !== undefined) handlers.set(`${event}:${layerOrHandler}`, handler);
    }),
    queryRenderedFeatures: vi.fn((): { properties: Record<string, unknown> }[] => []),
    getCanvas: () => canvas,
    setLayoutProperty: vi.fn(),
    setFeatureState: vi.fn(),
    easeTo: vi.fn(),
  };
}

let fakeMap = createFakeMap();

type FakeMapViewProps = {
  label: string;
  onReady: (map: ReturnType<typeof createFakeMap>) => void;
  onBasemapResolved: (available: boolean) => void;
  onUnavailable: () => void;
  children?: ReactNode;
};

vi.mock('@/shared/map', () => ({
  MapView: ({ label, onReady, onBasemapResolved, onUnavailable, children }: FakeMapViewProps) => {
    useEffect(() => {
      onBasemapResolved(false);
      if (mapMock.unavailable) onUnavailable();
      else onReady(fakeMap);
      // Подмена создаёт «карту» один раз, как MapView.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- только при монтировании
    }, []);
    return (
      <div role="region" aria-label={label}>
        {children}
      </div>
    );
  },
}));

const DRAFT_ID = '9a1c3e5b7d2f4a6c8e0b2d4f6a8c1e3b';
const READY_ID = '5c0b7f2e9a3d4e61b8f0c2a7d9e4b1f3';
const NO_GEOREF_ID = '0e8d2b6a4c1f47e9a3b5d7c9e1f2a4b6';
const PROCESSING_ID = '3f7b1d9c5e2a4b8d6f0c3e5a7b9d1f2c';
const FAILED_ID = 'b4e6a8c0d2f44b7e9a1c3e5b7d9f0a2c';
const AMBIGUOUS_ID = 'd1f3b5d7e9a14e2c4b6d8f0a2c4e6b8d';
const MAP_LABEL = 'План посадок: 19 деревьев, 19 кустарников, 10 зон запрета';

function ProjectsStub(): ReactNode {
  const navigationState: unknown = useLocation().state;
  const navigate = useNavigate();
  return (
    <>
      <h1>
        {JSON.stringify(navigationState) === JSON.stringify(FOCUS_PROJECTS_HEADING)
          ? 'Список, фокус на заголовке'
          : 'Список'}
      </h1>
      <button type="button" onClick={() => void navigate(-1)}>
        Назад в истории
      </button>
    </>
  );
}

const routes: RouteObject[] = [
  { path: '/projects/:projectId', Component: ProjectPage },
  { path: '/projects/new', element: <h1>Мастер загрузки</h1> },
  { path: '/', Component: ProjectsStub },
];

const renderProject = (id: string) => renderWithProviders(routes, `/projects/${id}`);

beforeEach(() => {
  fakeMap = createFakeMap();
  mapMock.unavailable = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  server.events.removeAllListeners();
});

describe('шапка', () => {
  test('ссылка «Проекты», название, статус с длительностью, описание, «Скачать DXF»', async () => {
    renderProject(READY_ID);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Сквер на Покровке' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Проекты' })).toHaveAttribute('href', '/');
    expect(screen.getByText('Готово')).toBeInTheDocument();
    expect(screen.getByText(/^обработано за /)).toBeInTheDocument();
    expect(screen.getByText('Благоустройство сквера, этап 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Скачать DXF' })).toBeInTheDocument();
    expect(document.title).toBe('Сквер на Покровке — Озеленение');
  });

  test.each([
    [DRAFT_ID, 'Загрузить архив'],
    [FAILED_ID, 'Загрузить архив'],
    [AMBIGUOUS_ID, 'Выбрать главный чертёж'],
    [READY_ID, null],
  ])('меню проекта %s: пункт %s', async (id, item) => {
    renderProject(id);
    await userEvent.click(await screen.findByRole('button', { name: 'Действия с проектом' }));
    await screen.findByRole('menuitem', { name: 'Удалить проект' });

    for (const label of ['Загрузить архив', 'Выбрать главный чертёж']) {
      const menuItem = screen.queryByRole('menuitem', { name: label });
      if (label === item) {
        expect(menuItem).toHaveAttribute('href', `/projects/new?project=${id}`);
      } else {
        expect(menuItem).not.toBeInTheDocument();
      }
    }
  });

  test('«Скачать DXF» — ошибка сервера показывается уведомлением', async () => {
    server.use(
      http.get('/api/projects/:projectId/dxf', () => new HttpResponse(null, { status: 500 })),
    );
    renderProject(READY_ID);

    await userEvent.click(await screen.findByRole('button', { name: 'Скачать DXF' }));

    expect(await screen.findByText(/Сервер не смог обработать запрос/)).toBeInTheDocument();
  });

  test('«Скачать DXF» — файл под именем проекта', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:dxf');
    URL.revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    renderProject(READY_ID);

    await userEvent.click(await screen.findByRole('button', { name: 'Скачать DXF' }));

    await waitFor(() => {
      expect(click).toHaveBeenCalledTimes(1);
    });
    const link = click.mock.contexts[0];
    if (!(link instanceof HTMLAnchorElement)) throw new Error('ожидалась ссылка');
    expect(link.download).toBe('Сквер на Покровке.dxf');
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });
});

describe('состояния проекта', () => {
  test('draft — «Архив не загружен» и переход в мастер', async () => {
    renderProject(DRAFT_ID);

    expect(await screen.findByRole('heading', { name: 'Архив не загружен' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Загрузить архив' })).toHaveAttribute(
      'href',
      `/projects/new?project=${DRAFT_ID}`,
    );
  });

  test('обработка — этапы, затем карта сама и «План посадок готов» для скринридера', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    renderProject(PROCESSING_ID);

    await act(() => vi.waitFor(() => screen.getByRole('list', { name: 'Этапы обработки' })));
    for (let passed = 0; passed < 25_000; passed += 1000) {
      await act(() => vi.advanceTimersByTimeAsync(1000));
    }

    await act(() => vi.waitFor(() => screen.getByRole('region', { name: /^План посадок:/ })));
    expect(screen.queryByRole('list', { name: 'Этапы обработки' })).not.toBeInTheDocument();
    expect(screen.getByText('План посадок готов')).toBeInTheDocument();
  });

  test('обработка закончилась выбором главного чертежа — это объявляется', async () => {
    const processing = {
      id: AMBIGUOUS_ID,
      name: 'Сквер на Новослободской',
      description: null,
      created_at: '2026-09-20T10:00:00Z',
      updated_at: '2026-09-20T10:00:00Z',
      status: 'zoning_layout',
      job: { stage: 'zoning_layout', progress_pct: 60, started_at: '2026-09-20T10:00:00Z' },
    };
    server.use(
      http.get('/api/projects/:projectId', () => HttpResponse.json(processing), { once: true }),
    );
    renderProject(AMBIGUOUS_ID);

    await screen.findByRole('list', { name: 'Этапы обработки' });
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent('Расчёт зон и посадок');

    // Следующий опрос (2 с) приходит уже от мока: failed с ambiguous_root_dxf.
    await waitFor(
      () => {
        expect(live).toHaveTextContent('В архиве несколько главных чертежей. Выберите нужный.');
      },
      { timeout: 4000 },
    );
    expect(live).toBeInTheDocument();
  });

  test('ошибка обработки — текст по коду и «Загрузить другой архив»', async () => {
    renderProject(FAILED_ID);

    expect(await screen.findByRole('alert')).toHaveTextContent(/Архив повреждён или это не ZIP/);
    expect(screen.getByRole('link', { name: 'Загрузить другой архив' })).toHaveAttribute(
      'href',
      `/projects/new?project=${FAILED_ID}`,
    );
  });

  test('несколько главных чертежей — выбор на экране, /runs, затем обработка', async () => {
    const runs = vi.fn();
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST' && request.url.endsWith('/runs')) runs();
    });
    renderProject(AMBIGUOUS_ID);

    await userEvent.click(await screen.findByRole('radio', { name: 'ГП/Генплан.dxf' }));
    await userEvent.click(screen.getByRole('button', { name: 'Продолжить обработку' }));

    expect(await screen.findByRole('list', { name: 'Этапы обработки' })).toBeInTheDocument();
    expect(runs).toHaveBeenCalledTimes(1);
  });

  test('проекта нет — «Страница не найдена»', async () => {
    renderProject('0000000000000000000000000000dead');

    expect(await screen.findByRole('heading', { name: 'Страница не найдена' })).toBeInTheDocument();
  });

  test('ошибка загрузки проекта — сообщение и «Повторить»', async () => {
    server.use(
      http.get('/api/projects/:projectId', () => new HttpResponse(null, { status: 500 }), {
        once: true,
      }),
    );
    renderProject(READY_ID);

    expect(await screen.findByRole('alert')).toHaveTextContent(/Сервер не смог обработать запрос/);
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Сквер на Покровке' }),
    ).toBeInTheDocument();
  });
});

describe('готовый проект', () => {
  test('пока данные грузятся — скелетон, затем карта с кратким содержанием', async () => {
    renderProject(READY_ID);

    expect(
      await screen.findByRole('status', { name: 'Загрузка плана посадок' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: MAP_LABEL })).toBeInTheDocument();
    expect(fakeMap.addLayer).toHaveBeenCalled();
    expect(fakeMap.addImage).toHaveBeenCalledWith(
      'prohibited-hatch',
      expect.objectContaining({ width: 8, height: 8 }),
      { pixelRatio: 1 },
    );
  });

  test('ошибка данных — сообщение и «Повторить» на месте карты, «Скачать DXF» доступна', async () => {
    server.use(
      http.get('/api/projects/:projectId/planting', () => new HttpResponse(null, { status: 500 }), {
        once: true,
      }),
    );
    renderProject(READY_ID);

    expect(await screen.findByRole('alert')).toHaveTextContent(/Сервер не смог обработать запрос/);
    expect(screen.getByRole('button', { name: 'Скачать DXF' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('region', { name: MAP_LABEL })).toBeInTheDocument();
  });

  test('нет WebGL — запасной план без подложки', async () => {
    mapMock.unavailable = true;
    renderProject(READY_ID);

    expect(
      await screen.findByText(
        'Карта недоступна в этом браузере. Показан план посадок без подложки',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: MAP_LABEL })).toBeInTheDocument();
  });

  test('участок за пределами карты Москвы — план без подложки', async () => {
    server.use(
      http.get('/api/projects/:projectId/planting', () =>
        HttpResponse.json({
          type: 'FeatureCollection',
          metadata: { crs: 'EPSG:4326 (WGS84 lon/lat)' },
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [47.6, 55.75] },
              properties: {
                id: 'TREE_ROW_CURB-00001',
                plant_type: 'tree',
                rule_id: 'TREE_ROW_CURB',
              },
            },
          ],
        }),
      ),
    );
    renderProject(READY_ID);

    expect(
      await screen.findByText(
        'Участок за пределами карты Москвы. Показан план посадок без подложки',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^План посадок/ })).not.toBeInTheDocument();
  });

  test('нет геопривязки — план в координатах чертежа, карта не создаётся', async () => {
    renderProject(NO_GEOREF_ID);

    expect(
      await screen.findByText(
        'У проекта нет геопривязки. Показан план посадок в координатах чертежа',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^План посадок/ })).not.toBeInTheDocument();
  });
});

describe('панель «Слои»', () => {
  test('счётчики со склонением, «Подложка» неактивна без подложки', async () => {
    renderProject(READY_ID);

    expect(await screen.findByRole('switch', { name: 'Деревья, 19 деревьев' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Кустарники, 19 кустарников' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Зоны запрета, 10 зон запрета' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Подложка' })).toBeDisabled();
  });

  test('переключатель скрывает слои группы и возвращает их', async () => {
    renderProject(READY_ID);
    const trees = await screen.findByRole('switch', { name: 'Деревья, 19 деревьев' });

    await userEvent.click(trees);

    for (const layer of ['tree-shadows', 'trees', 'tree-highlights']) {
      expect(fakeMap.setLayoutProperty).toHaveBeenCalledWith(layer, 'visibility', 'none');
    }
    expect(fakeMap.setLayoutProperty).not.toHaveBeenCalledWith('shrubs', 'visibility', 'none');

    await userEvent.click(trees);
    expect(fakeMap.setLayoutProperty).toHaveBeenLastCalledWith(
      'prohibited-zones-hatch',
      'visibility',
      'visible',
    );
    expect(fakeMap.setLayoutProperty).toHaveBeenCalledWith('trees', 'visibility', 'visible');
  });
});

describe('панель «Посадка»', () => {
  const selectFirstTree = async () => {
    await screen.findByRole('region', { name: MAP_LABEL });
    fakeMap.queryRenderedFeatures.mockReturnValue([{ properties: { id: 'TREE_ROW_CURB-00001' } }]);
    act(() => {
      fakeMap.handlers.get('click')?.({ point: { x: 10, y: 10 } });
    });
    return screen.findByRole('region', { name: 'Посадка' });
  };

  test('выбор посадки открывает панель и выделяет её через feature-state', async () => {
    renderProject(READY_ID);

    const panel = await selectFirstTree();

    expect(within(panel).getByText('Дерево')).toBeInTheDocument();
    expect(
      await within(panel).findByText('Рядовая/аллейная посадка вдоль борта'),
    ).toBeInTheDocument();
    expect(within(panel).getByText('Радиус кроны 1,5 м')).toBeInTheDocument();
    expect(within(panel).getByText('TREE_ROW_CURB-00001')).toBeInTheDocument();
    expect(fakeMap.setFeatureState).toHaveBeenLastCalledWith(
      { source: 'result-planting', id: 'TREE_ROW_CURB-00001' },
      { selected: true },
    );
  });

  test('закрывается по Esc, когда фокус в панели, и снимает выделение', async () => {
    renderProject(READY_ID);
    const panel = await selectFirstTree();

    within(panel).getByRole('button', { name: 'Закрыть' }).focus();
    await userEvent.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Посадка' })).not.toBeInTheDocument();
    });
    expect(fakeMap.setFeatureState).toHaveBeenLastCalledWith(
      { source: 'result-planting', id: 'TREE_ROW_CURB-00001' },
      { selected: false },
    );
    expect(fakeMap.canvas.focus).toHaveBeenCalled();
  });

  test('Esc на переключателе слоёв закрывает панель, фокус остаётся на месте', async () => {
    renderProject(READY_ID);
    await selectFirstTree();
    const shrubs = screen.getByRole('switch', { name: 'Кустарники, 19 кустарников' });

    shrubs.focus();
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('region', { name: 'Посадка' })).not.toBeInTheDocument();
    expect(fakeMap.canvas.focus).not.toHaveBeenCalled();
    expect(shrubs).toHaveFocus();
  });

  test('Esc в открытом списке «Найти посадку» закрывает список, а не панель', async () => {
    renderProject(READY_ID);
    await selectFirstTree();

    await userEvent.click(screen.getByPlaceholderText('Номер посадки'));
    await screen.findByRole('option', { name: 'Дерево TREE_ROW_CURB-00001' });
    await userEvent.keyboard('{Escape}');

    expect(screen.getByRole('region', { name: 'Посадка' })).toBeInTheDocument();
  });

  test('Esc вне карты выбор не снимает', async () => {
    renderProject(READY_ID);
    await selectFirstTree();

    screen.getByRole('button', { name: 'Скачать DXF' }).focus();
    await userEvent.keyboard('{Escape}');

    expect(screen.getByRole('region', { name: 'Посадка' })).toBeInTheDocument();
  });

  test('с клавиатуры — выбор из списка «Найти посадку»', async () => {
    renderProject(READY_ID);
    await screen.findByRole('region', { name: MAP_LABEL });

    screen.getByPlaceholderText('Номер посадки').focus();
    await userEvent.keyboard('TREE_ROW_CURB-00001');
    await screen.findByRole('option', { name: 'Дерево TREE_ROW_CURB-00001' });
    await userEvent.keyboard('{ArrowDown}{Enter}');

    const panel = await screen.findByRole('region', { name: 'Посадка' });
    expect(within(panel).getByText('TREE_ROW_CURB-00001')).toBeInTheDocument();
    const response = await fetch(`/api/projects/${READY_ID}/planting`);
    // Ответ мока соответствует PlantingFeatureCollection контракта: берутся только нужные поля.
    const { features } = (await response.json()) as {
      features: { geometry: { coordinates: number[] }; properties: { id: string } }[];
    };
    const tree = features.find(({ properties }) => properties.id === 'TREE_ROW_CURB-00001');
    expect(fakeMap.easeTo).toHaveBeenCalledWith({ center: tree?.geometry.coordinates });
  });

  test('выключение слоя выбранной посадки снимает выбор', async () => {
    renderProject(READY_ID);
    await selectFirstTree();

    await userEvent.click(screen.getByRole('switch', { name: 'Кустарники, 19 кустарников' }));
    expect(screen.getByRole('region', { name: 'Посадка' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('switch', { name: 'Деревья, 19 деревьев' }));
    expect(screen.queryByRole('region', { name: 'Посадка' })).not.toBeInTheDocument();

    // Скрытые деревья и в поиске не предлагаются.
    await userEvent.click(screen.getByPlaceholderText('Номер посадки'));
    await userEvent.keyboard('TREE_ROW_CURB');
    expect(await screen.findByText('Посадка не найдена')).toBeInTheDocument();
  });

  test('закрывается кнопкой и кликом по пустому месту', async () => {
    renderProject(READY_ID);
    const panel = await selectFirstTree();

    await userEvent.click(within(panel).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('region', { name: 'Посадка' })).not.toBeInTheDocument();
    expect(fakeMap.canvas.focus).toHaveBeenCalledTimes(1);

    await selectFirstTree();
    fakeMap.queryRenderedFeatures.mockReturnValue([]);
    act(() => {
      fakeMap.handlers.get('click')?.({ point: { x: 1, y: 1 } });
    });
    expect(screen.queryByRole('region', { name: 'Посадка' })).not.toBeInTheDocument();
  });
});

describe('удаление с экрана проекта', () => {
  test('переход к списку с фокусом на заголовке и уведомление', async () => {
    renderProject(READY_ID);

    await userEvent.click(await screen.findByRole('button', { name: 'Действия с проектом' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Удалить проект' }));
    const dialog = await screen.findByRole('dialog', { name: 'Удалить проект?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }));

    expect(
      await screen.findByRole('heading', { name: 'Список, фокус на заголовке' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Проект удалён')).toBeInTheDocument();

    // Запись удалённого проекта заменена: «Назад» на неё не ведёт.
    await userEvent.click(screen.getByRole('button', { name: 'Назад в истории' }));
    expect(screen.getByRole('heading', { name: 'Список, фокус на заголовке' })).toBeInTheDocument();
  });

  test('во время обработки удаление недоступно', async () => {
    renderProject(PROCESSING_ID);

    await userEvent.click(await screen.findByRole('button', { name: 'Действия с проектом' }));

    expect(await screen.findByRole('menuitem', { name: 'Удалить проект' })).toBeDisabled();
    expect(screen.getByText('Удалить можно после завершения обработки')).toBeInTheDocument();
  });
});

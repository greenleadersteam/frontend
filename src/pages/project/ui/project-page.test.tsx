import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { type ReactNode, useEffect } from 'react';
import { type RouteObject, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { dimensionLabelsMinZoom } from '@/entities/project';
import type * as Config from '@/shared/config';
import { FOCUS_PROJECTS_HEADING } from '@/shared/config';
import { renderWithProviders, server } from '@/shared/lib/test';

import { ProjectPage } from './project-page';

// Карта в jsdom не рисуется: модуль карты подменяется на границе ленивого импорта.
// Подмена отдаёт экрану объект с теми методами MapLibre, которыми экран пользуется.
type Handler = (event: { point: { x: number; y: number } }) => void;
type QueryOptions = { layers: string[] };

const mapMock = vi.hoisted(() => ({ unavailable: false }));

// Моки реализуют весь контракт, и сервер в тестах объявляет все возможности. Проверки по зонам
// запрета — поведение сервера без /obstacles: такие тесты выключают возможность obstacles.
const serverMock = vi.hoisted(() => ({ obstacles: true }));
vi.mock('@/shared/config', async (importOriginal) => {
  const actual = await importOriginal<typeof Config>();
  return {
    ...actual,
    useCapability: (name: Config.Capability) =>
      name === 'obstacles' ? serverMock.obstacles : actual.useCapability(name),
  };
});

function createFakeMap() {
  const handlers = new Map<string, Handler>();
  const canvas = { style: { cursor: '' }, focus: vi.fn() };
  const dimensions = { setData: vi.fn<(data: unknown) => Promise<void>>(() => Promise.resolve()) };
  return {
    handlers,
    canvas,
    dimensions,
    getPixelRatio: () => 1,
    addImage: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    on: vi.fn((event: string, layerOrHandler: string | Handler, handler?: Handler) => {
      if (typeof layerOrHandler === 'function') handlers.set(event, layerOrHandler);
      else if (handler !== undefined) handlers.set(`${event}:${layerOrHandler}`, handler);
    }),
    queryRenderedFeatures: vi.fn<
      (point: unknown, options: QueryOptions) => { properties: Record<string, unknown> }[]
    >(() => []),
    getCanvas: () => canvas,
    getZoom: vi.fn(() => 19),
    getSource: (id: string) => (id === 'result-dimensions' ? dimensions : undefined),
    setLayoutProperty: vi.fn(),
    setFilter: vi.fn(),
    setFeatureState: vi.fn(),
    easeTo: vi.fn<(options: { center: number[]; zoom?: number }) => void>(),
    resize: vi.fn(),
  };
}

let fakeMap = createFakeMap();

type FakeMapViewProps = {
  label: string;
  note?: string;
  onReady: (map: ReturnType<typeof createFakeMap>) => void;
  onBasemapResolved: (available: boolean) => void;
  onUnavailable: () => void;
  children?: ReactNode;
};

vi.mock('@/shared/map', () => ({
  MapView: ({
    label,
    note,
    onReady,
    onBasemapResolved,
    onUnavailable,
    children,
  }: FakeMapViewProps) => {
    useEffect(() => {
      onBasemapResolved(false);
      if (mapMock.unavailable) onUnavailable();
      else onReady(fakeMap);
      // Подмена создаёт «карту» один раз, как MapView.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- только при монтировании
    }, []);
    return (
      <div role="region" aria-label={label}>
        {note}
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
  serverMock.obstacles = true;
});

afterEach(() => {
  // Подмены браузерных API в отдельных тестах; restoreAllMocks их не откатывает.
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
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
    expect(
      screen.getByText('Демонстрационный проект. Благоустройство сквера, этап 1'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Скачать DXF' })).toBeInTheDocument();
    expect(document.title).toBe('Сквер на Покровке — Озеленение');
  });

  test.each([
    [DRAFT_ID, 'Загрузить архив'],
    [FAILED_ID, 'Загрузить архив'],
    [AMBIGUOUS_ID, null],
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
      http.get(
        '/api/projects/:projectId/explanation',
        () => new HttpResponse(null, { status: 500 }),
        { once: true },
      ),
    );
    renderProject(READY_ID);

    expect(await screen.findByRole('alert')).toHaveTextContent(/Сервер не смог обработать запрос/);
    expect(screen.getByRole('button', { name: 'Скачать DXF' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('region', { name: MAP_LABEL })).toBeInTheDocument();
  });

  test('нет WebGL — запасной план', async () => {
    mapMock.unavailable = true;
    renderProject(READY_ID);

    expect(
      await screen.findByText('Карта недоступна в этом браузере. Показан план посадок.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: MAP_LABEL })).toBeInTheDocument();
  });

  test('участок за пределами карты Москвы — та же карта без подложки', async () => {
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

    const map = await screen.findByRole('region', { name: /^План посадок/ });
    expect(map).toHaveTextContent('Участок за пределами карты Москвы, подложки нет');
    expect(screen.queryByRole('switch', { name: 'Подложка' })).not.toBeInTheDocument();
  });

  test('нет геопривязки — та же карта в координатах чертежа, без подложки', async () => {
    renderProject(NO_GEOREF_ID);

    const map = await screen.findByRole('region', { name: /^План посадок/ });
    expect(map).toHaveTextContent('Координаты чертежа, без привязки к городу');
    expect(screen.queryByRole('switch', { name: 'Подложка' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('панель «Слои»', () => {
  test('счётчики со склонением, «Подложка» неактивна без подложки', async () => {
    renderProject(READY_ID);

    expect(await screen.findByRole('switch', { name: 'Деревья, 19 деревьев' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Кустарники, 19 кустарников' })).toBeChecked();
    // Зоны запрета — для выбранного типа посадки, по умолчанию деревьев.
    expect(screen.getByRole('switch', { name: 'Зоны запрета, 5 зон запрета' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Подложка' })).toBeDisabled();
  });

  test('газон с площадью и граница участка — свои строки и слои', async () => {
    renderProject(READY_ID);

    // Газон мока — 60 × 20 м.
    const lawn = await screen.findByRole('switch', { name: /^Газон, площадь 1\s200\sм²$/ });
    const boundary = screen.getByRole('switch', { name: 'Граница участка' });
    expect(lawn).toBeChecked();
    expect(boundary).toBeChecked();

    await userEvent.click(lawn);
    expect(fakeMap.setLayoutProperty).toHaveBeenCalledWith('lawn', 'visibility', 'none');
    await userEvent.click(boundary);
    expect(fakeMap.setLayoutProperty).toHaveBeenCalledWith('site-boundary', 'visibility', 'none');
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
    expect(fakeMap.setLayoutProperty).toHaveBeenCalledWith('trees', 'visibility', 'visible');
  });
});

// Первое дерево мока стоит в (3; 2,2) м от угла газона: под ним бортовой камень (y = 0,
// отступ 0,7 м), кабель (y = 4,5, отступ 2 м) и газопровод (y = 12, отступ 1,5 м).
const FIRST_TREE = 'TREE_ROW_CURB-00001';

const clickMap = (
  plantingId: string | null,
  zoneIndex: number | null = null,
  obstacleIndex: number | null = null,
) => {
  fakeMap.queryRenderedFeatures.mockImplementation((_point, { layers }) => {
    if (layers.includes('trees'))
      return plantingId === null ? [] : [{ properties: { id: plantingId } }];
    if (layers.includes('obstacle-utilities-solid'))
      return obstacleIndex === null ? [] : [{ properties: { obstacle_index: obstacleIndex } }];
    return zoneIndex === null ? [] : [{ properties: { zone_index: zoneIndex } }];
  });
  act(() => {
    fakeMap.handlers.get('click')?.({ point: { x: 10, y: 10 } });
  });
};

const selectFirstTree = async () => {
  await screen.findByRole('region', { name: MAP_LABEL });
  clickMap(FIRST_TREE);
  return screen.findByRole('region', { name: 'Дерево' });
};

type DimensionData = {
  features: { properties: { kind: string; check: number; emphasis: string; text?: string } }[];
};

const lastDimensions = (): DimensionData['features'] => {
  const data: unknown = fakeMap.dimensions.setData.mock.lastCall?.[0];
  // Экран передаёт в источник результат dimensionLines — FeatureCollection.
  return (data as DimensionData).features;
};

describe('панель «Посадка»', () => {
  test('заголовок — тип, правило из /explanation, идентификатор, feature-state', async () => {
    renderProject(READY_ID);

    const panel = await selectFirstTree();

    expect(within(panel).getByText('Рядовая/аллейная посадка вдоль борта')).toBeInTheDocument();
    expect(within(panel).getByText(FIRST_TREE)).toBeInTheDocument();
    expect(fakeMap.setFeatureState).toHaveBeenLastCalledWith(
      { source: 'result-planting', id: FIRST_TREE },
      { selected: true },
    );
  });

  test('без /obstacles — проверки по зонам запрета: по возрастанию запаса, с нормой и источником', async () => {
    serverMock.obstacles = false;
    renderProject(READY_ID);
    const panel = await selectFirstTree();

    const checks = within(within(panel).getByRole('list', { name: 'Проверки' })).getAllByRole(
      'listitem',
    );
    expect(checks.map((check) => within(check).getAllByText(/./)[0]?.textContent)).toEqual([
      'Силовой кабель',
      'Бортовой камень',
      'Газопровод',
    ]);
    expect(checks[0]).toHaveTextContent('2,3 м при норме не менее 2 м');
    expect(checks[0]).toHaveTextContent('743-ПП — силовой кабель и кабель связи');
    expect(within(checks[0] ?? panel).getByRole('img', { name: 'Норма выполнена' })).toBeVisible();
    expect(checks[1]).toHaveTextContent('2,2 м при норме не менее 0,7 м');
    // До газопровода ближе край участка, чем его зона: точное расстояние неизвестно.
    expect(checks[2]).toHaveTextContent(/до границы зоны 8,\d м/);
    expect(
      within(panel).getByText(
        'Отступы не проверялись для объектов: здания и сооружения, край дорожек и тротуаров, колодцы и люки',
      ),
    ).toBeVisible();
  });

  test('без /obstacles — размерные линии у трёх ближайших зон, наведение выделяет свою', async () => {
    serverMock.obstacles = false;
    renderProject(READY_ID);
    const panel = await selectFirstTree();

    const labels = lastDimensions()
      .filter(({ properties }) => properties.kind === 'label')
      .map(({ properties }) => properties.text?.replace('\u00A0', ' '));
    expect(labels).toEqual(['0,3 м', '2 м', '1,5 м', '0,7 м', '8,3 м']);

    const [, roadEdge] = within(panel).getAllByRole('listitem');
    await userEvent.hover(roadEdge ?? panel);
    const emphasis = new Set(
      lastDimensions().map(
        ({ properties }) => `${String(properties.check)}:${properties.emphasis}`,
      ),
    );
    expect(emphasis).toEqual(new Set(['0:dim', '1:focus', '2:dim']));

    await userEvent.unhover(roadEdge ?? panel);
    expect(lastDimensions().every(({ properties }) => properties.emphasis === 'normal')).toBe(true);
  });

  test('координаты — широта и долгота, координаты чертежа, «Скопировать»', async () => {
    // В jsdom нет Clipboard API.
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderProject(READY_ID);
    const panel = await selectFirstTree();

    expect(within(panel).getByText(/^Ш 55,759\d{3}, Д 37,645\d{3}$/)).toBeInTheDocument();
    expect(
      within(panel).getByText('В координатах чертежа: X 3,00 м, Y 2,20 м'),
    ).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Скопировать' }));

    expect(writeText.mock.lastCall?.[0]).toMatch(
      /^Ш 55,759\d{3}, Д 37,645\d{3}\nВ координатах чертежа: X 3,00\u00A0м, Y 2,20\u00A0м$/,
    );
    expect(await screen.findByText('Координаты скопированы')).toBeInTheDocument();
  });

  test('без Clipboard API — сообщение, что скопировать не удалось', async () => {
    renderProject(READY_ID);
    const panel = await selectFirstTree();

    await userEvent.click(within(panel).getByRole('button', { name: 'Скопировать' }));

    expect(
      await screen.findByText(
        'Не удалось скопировать координаты. Выделите их и скопируйте вручную.',
      ),
    ).toBeInTheDocument();
  });

  test('«Показать зону» у проверки открывает панель зоны с клавиатуры', async () => {
    serverMock.obstacles = false;
    renderProject(READY_ID);
    const panel = await selectFirstTree();

    within(panel).getByRole('button', { name: 'Показать зону: Силовой кабель' }).focus();
    await userEvent.keyboard('{Enter}');

    const zone = await screen.findByRole('region', { name: 'Силовой кабель' });
    expect(within(zone).getByText('Отступ для деревьев не менее 2 м')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Дерево' })).not.toBeInTheDocument();

    // Кнопка исчезла вместе с панелью посадки: фокус — в панели зоны, и Esc её закрывает.
    await waitFor(() => {
      expect(zone).toHaveFocus();
    });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Силовой кабель' })).not.toBeInTheDocument();
  });

  test('«Показать зону» включает выключенный слой зон', async () => {
    serverMock.obstacles = false;
    renderProject(READY_ID);
    const panel = await selectFirstTree();
    await userEvent.click(screen.getByRole('switch', { name: 'Зоны запрета, 5 зон запрета' }));

    await userEvent.click(
      within(panel).getByRole('button', { name: 'Показать зону: Силовой кабель' }),
    );

    expect(
      await screen.findByRole('switch', { name: 'Зоны запрета, 5 зон запрета' }),
    ).toBeChecked();
  });

  test('без геопривязки — только координаты чертежа', async () => {
    renderProject(NO_GEOREF_ID);
    await screen.findByRole('region', { name: /^План посадок/ });
    clickMap(FIRST_TREE);

    const panel = await screen.findByRole('region', { name: 'Дерево' });
    expect(within(panel).getByText('В координатах чертежа: X 3,00 м, Y 2,20 м')).toBeVisible();
    expect(within(panel).queryByText(/^Ш /)).not.toBeInTheDocument();
    expect(within(panel).getByRole('list', { name: 'Проверки' })).toBeInTheDocument();
  });

  test('клик по зоне запрета — панель зоны с нормой и площадью, выделение контура', async () => {
    renderProject(READY_ID);
    await screen.findByRole('region', { name: MAP_LABEL });

    clickMap(null, 1);

    const panel = await screen.findByRole('region', { name: 'Силовой кабель' });
    expect(within(panel).getByText('Зона запрета')).toBeInTheDocument();
    expect(within(panel).getByText('Отступ для деревьев не менее 2 м')).toBeInTheDocument();
    expect(within(panel).getByText('743-ПП — силовой кабель и кабель связи')).toBeInTheDocument();
    // Полоса 60 × 4 м.
    expect(within(panel).getByText(/^Площадь по данным карты: 24\d м²$/)).toBeInTheDocument();
    expect(fakeMap.setFeatureState).toHaveBeenLastCalledWith(
      { source: 'result-prohibited-zones', id: 1 },
      { selected: true },
    );
  });

  test('закрывается по Esc, когда фокус в панели, и снимает выделение', async () => {
    renderProject(READY_ID);
    const panel = await selectFirstTree();

    within(panel).getByRole('button', { name: 'Закрыть' }).focus();
    await userEvent.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Дерево' })).not.toBeInTheDocument();
    });
    expect(fakeMap.setFeatureState).toHaveBeenLastCalledWith(
      { source: 'result-planting', id: FIRST_TREE },
      { selected: false },
    );
    expect(fakeMap.canvas.focus).toHaveBeenCalled();
    expect(lastDimensions()).toEqual([]);
  });

  test('Esc на переключателе слоёв закрывает панель, фокус остаётся на месте', async () => {
    renderProject(READY_ID);
    await selectFirstTree();
    const shrubs = screen.getByRole('switch', { name: 'Кустарники, 19 кустарников' });

    shrubs.focus();
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('region', { name: 'Дерево' })).not.toBeInTheDocument();
    expect(fakeMap.canvas.focus).not.toHaveBeenCalled();
    expect(shrubs).toHaveFocus();
  });

  test('Esc в открытом списке «Найти посадку» закрывает список, а не панель', async () => {
    renderProject(READY_ID);
    await selectFirstTree();

    await userEvent.click(screen.getByPlaceholderText('Номер посадки'));
    await screen.findByRole('option', { name: `Дерево ${FIRST_TREE}` });
    await userEvent.keyboard('{Escape}');

    expect(screen.getByRole('region', { name: 'Дерево' })).toBeInTheDocument();
  });

  test('Esc вне карты выбор не снимает', async () => {
    renderProject(READY_ID);
    await selectFirstTree();

    screen.getByRole('button', { name: 'Скачать DXF' }).focus();
    await userEvent.keyboard('{Escape}');

    expect(screen.getByRole('region', { name: 'Дерево' })).toBeInTheDocument();
  });

  test('с клавиатуры — выбор из списка «Найти посадку»', async () => {
    renderProject(READY_ID);
    await screen.findByRole('region', { name: MAP_LABEL });

    screen.getByPlaceholderText('Номер посадки').focus();
    await userEvent.keyboard(FIRST_TREE);
    await screen.findByRole('option', { name: `Дерево ${FIRST_TREE}` });
    await userEvent.keyboard('{ArrowDown}{Enter}');

    const panel = await screen.findByRole('region', { name: 'Дерево' });
    expect(within(panel).getByText(FIRST_TREE)).toBeInTheDocument();
    expect(fakeMap.easeTo).toHaveBeenCalledWith({ center: await firstTreeCoordinates() });
  });

  test('выключение слоя выбранной посадки снимает выбор', async () => {
    renderProject(READY_ID);
    await selectFirstTree();

    await userEvent.click(screen.getByRole('switch', { name: 'Кустарники, 19 кустарников' }));
    expect(screen.getByRole('region', { name: 'Дерево' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('switch', { name: 'Деревья, 19 деревьев' }));
    expect(screen.queryByRole('region', { name: 'Дерево' })).not.toBeInTheDocument();

    // Скрытые деревья и в поиске не предлагаются.
    await userEvent.click(screen.getByPlaceholderText('Номер посадки'));
    await userEvent.keyboard('TREE_ROW_CURB');
    expect(await screen.findByText('Посадка не найдена')).toBeInTheDocument();
  });

  test('закрывается кнопкой и кликом по пустому месту', async () => {
    renderProject(READY_ID);
    const panel = await selectFirstTree();

    await userEvent.click(within(panel).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('region', { name: 'Дерево' })).not.toBeInTheDocument();
    expect(fakeMap.canvas.focus).toHaveBeenCalledTimes(1);

    await selectFirstTree();
    clickMap(null);
    expect(screen.queryByRole('region', { name: 'Дерево' })).not.toBeInTheDocument();
  });
});

// Одна посадка у точки (37,6452; 55,7593) и одна зона запрета: рядом или на ней.
function mockSinglePlanting({ zoneOverPlanting }: { zoneOverPlanting: boolean }) {
  const [lon, lat] = [37.6452, 55.7593];
  // 0,001° долготы на этой широте — около 63 м: зона вдали от посадки.
  const offset = zoneOverPlanting ? 0 : 0.001;
  const square = (half: number) => [
    [lon + offset - half, lat - half],
    [lon + offset + half, lat - half],
    [lon + offset + half, lat + half],
    [lon + offset - half, lat + half],
    [lon + offset - half, lat - half],
  ];
  server.use(
    http.get('/api/projects/:projectId/planting', () =>
      HttpResponse.json({
        type: 'FeatureCollection',
        metadata: { crs: 'EPSG:4326 (WGS84 lon/lat)' },
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lon, lat] },
            properties: { id: 'TREE-1', plant_type: 'tree', rule_id: 'TREE_FILL_LAWN' },
          },
        ],
      }),
    ),
    http.get('/api/projects/:projectId/zones', () =>
      HttpResponse.json({
        type: 'FeatureCollection',
        metadata: {
          crs: 'EPSG:4326 (WGS84 lon/lat)',
          used_site_boundary: false,
          uncovered_categories: [],
        },
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [square(0.00005)] },
            properties: {
              zone_type: 'prohibited',
              plant_type: 'tree',
              obstacle_category: 'underground_utilities',
              obstacle_subtype: 'heat',
              distance_m: 2,
              citation: '',
              reason: '< 2 м от объекта типа «heat»',
            },
          },
        ],
      }),
    ),
    http.get('/api/projects/:projectId/explanation', () =>
      HttpResponse.json([
        {
          id: 'TREE-1',
          plant_type: 'tree',
          rule_id: 'TREE_FILL_LAWN',
          rule_name_ru: null,
          x: 1,
          y: 2,
        },
      ]),
    ),
  );
}

describe('«можно» и «нельзя»', () => {
  test('по умолчанию — деревья; «Кустарники» переключает «можно» и зоны запрета', async () => {
    // Строка «Можно сажать» — с площадью разрешённой области выбранного типа.
    const allowedLabel = () => {
      const row = screen.getByRole('switch', { name: /^Можно сажать, площадь / });
      return row instanceof HTMLInputElement ? row.labels?.[0]?.textContent : null;
    };
    renderProject(READY_ID);
    await screen.findByRole('switch', { name: /^Можно сажать, площадь / });
    const treeArea = allowedLabel();

    await userEvent.click(screen.getByRole('radio', { name: 'Кустарники' }));

    expect(fakeMap.setFilter).toHaveBeenLastCalledWith('prohibited-zones-outline', [
      '==',
      ['get', 'plant_type'],
      'shrub',
    ]);
    expect(fakeMap.setFilter).toHaveBeenCalledWith('allowed-area', [
      'all',
      ['==', ['get', 'zone_type'], 'allowed'],
      ['==', ['get', 'plant_type'], 'shrub'],
    ]);
    // У кустарника нормы меньше — разрешённая область другая.
    expect(treeArea).toMatch(/^Можно сажать[\d\s]+м²/);
    expect(allowedLabel()).not.toBe(treeArea);
  });

  test('выбранная зона другого типа посадки при переключении снимается', async () => {
    renderProject(READY_ID);
    await screen.findByRole('region', { name: MAP_LABEL });
    clickMap(null, 1);
    await screen.findByRole('region', { name: 'Силовой кабель' });

    await userEvent.click(screen.getByRole('radio', { name: 'Кустарники' }));

    expect(screen.queryByRole('region', { name: 'Силовой кабель' })).not.toBeInTheDocument();
  });
});

describe('исходные объекты', () => {
  test('группа «Исходные объекты» с переключателями и условными знаками сетей', async () => {
    renderProject(READY_ID);

    expect(await screen.findByRole('heading', { name: 'Исходные объекты' })).toBeVisible();
    const utilities = screen.getByRole('switch', { name: 'Сети' });
    expect(utilities).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Здания' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Бортовой камень и тротуары' })).toBeChecked();
    expect(
      within(screen.getByRole('list', { name: 'Условные знаки сетей' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Силовой кабель', 'Газопровод', 'Водопровод']);

    await userEvent.click(utilities);

    for (const layer of [
      'obstacle-utilities-solid',
      'obstacle-utilities-dashed',
      'obstacle-utilities-dash-dot',
      'obstacle-utility-labels',
    ]) {
      expect(fakeMap.setLayoutProperty).toHaveBeenCalledWith(layer, 'visibility', 'none');
    }
  });

  test('клик по сети — панель «Объект»: слой и handle DXF, нормы для дерева и кустарника', async () => {
    renderProject(READY_ID);
    await screen.findByRole('region', { name: MAP_LABEL });

    // Газопровод — третий объект /obstacles демо-участка.
    clickMap(null, 1, 2);

    const panel = await screen.findByRole('region', { name: 'Газопровод' });
    expect(within(panel).getByText('Подземная сеть')).toBeInTheDocument();
    expect(within(panel).getByText('Слой DXF: Газопровод')).toBeInTheDocument();
    expect(within(panel).getByText('Handle: 2C7')).toBeInTheDocument();
    const norms = within(within(panel).getByRole('list', { name: 'Нормы отступа' })).getAllByRole(
      'listitem',
    );
    expect(norms[0]).toHaveTextContent('Для деревьев — не ближе 1,5 м');
    expect(norms[0]).toHaveTextContent(
      'ПП Москвы от 10.09.2002 № 743-ПП, прил. 1, п. 3.6.3, табл. 3.6.1, строка «газопровод, канализация»',
    );
    // У кустарника пункт не подтверждён: акт без пункта и объяснение значения.
    expect(norms[1]).toHaveTextContent('Для кустарников — не ближе 1,5 м');
    expect(norms[1]).not.toHaveTextContent('п. 3.6.3');
    expect(norms[1]).toHaveTextContent('для кустарника нормы нет');
    expect(fakeMap.setFeatureState).toHaveBeenLastCalledWith(
      { source: 'result-obstacles', id: 2 },
      { selected: true },
    );
  });

  test('сбой /obstacles план не закрывает: проверки — по зонам запрета, с пояснением', async () => {
    server.use(
      http.get('/api/projects/:projectId/obstacles', () => new HttpResponse(null, { status: 500 })),
    );
    renderProject(READY_ID);

    const panel = await selectFirstTree();

    expect(
      screen.getByText(/^Объекты подосновы не загрузились: проверки посчитаны по зонам запрета\./),
    ).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Исходные объекты' })).not.toBeInTheDocument();
    expect(
      within(panel).getByRole('button', { name: 'Показать зону: Силовой кабель' }),
    ).toBeVisible();
  });

  test('без возможности obstacles — ни группы, ни запроса', async () => {
    serverMock.obstacles = false;
    const requests: string[] = [];
    server.events.on('request:start', ({ request }) => {
      requests.push(new URL(request.url).pathname);
    });
    renderProject(READY_ID);
    await screen.findByRole('region', { name: MAP_LABEL });

    expect(screen.queryByRole('heading', { name: 'Исходные объекты' })).not.toBeInTheDocument();
    expect(requests.filter((path) => path.endsWith('/obstacles') || path === '/api/norms')).toEqual(
      [],
    );
  });
});

describe('проверки по объектам', () => {
  test('серверные проверки: факт, норма с пунктом, «Показать объект»', async () => {
    renderProject(READY_ID);
    const panel = await selectFirstTree();

    const checks = within(within(panel).getByRole('list', { name: 'Проверки' })).getAllByRole(
      'listitem',
    );
    expect(checks.map((check) => within(check).getAllByText(/./)[0]?.textContent)).toEqual([
      'Силовой кабель',
      'Бортовой камень',
      'Газопровод',
      'Водопровод',
      'Существующее дерево',
    ]);
    expect(checks[0]).toHaveTextContent('2,3 м при норме не менее 2 м');
    expect(checks[0]).toHaveTextContent(
      'ПП Москвы от 10.09.2002 № 743-ПП, прил. 1, п. 3.6.3, табл. 3.6.1, строка «силовой кабель и кабель связи»',
    );

    await userEvent.click(
      within(panel).getByRole('button', { name: 'Показать объект: Силовой кабель' }),
    );

    const obstacle = await screen.findByRole('region', { name: 'Силовой кабель' });
    expect(within(obstacle).getByText('Слой DXF: Кабель электроснабжения')).toBeInTheDocument();
  });

  test('размерная линия — до линии сети, подпись факта и отметка нормы', async () => {
    renderProject(READY_ID);
    await selectFirstTree();

    const labels = lastDimensions()
      .filter(({ properties }) => properties.kind === 'label')
      .map(({ properties }) => properties.text?.replace('\u00A0', ' '));
    // Три ближайших объекта; водопровод и дерево дальше порога — линии у них нет.
    expect(labels).toEqual(['2,3 м', 'норма 2 м', '2,2 м', 'норма 0,7 м', '9,8 м', 'норма 1,5 м']);
  });
});

describe('панель «Посадка» — крайние случаи', () => {
  test('рядом ничего нет, границы участка нет', async () => {
    serverMock.obstacles = false;
    mockSinglePlanting({ zoneOverPlanting: false });
    renderProject(READY_ID);
    await screen.findByRole('region', { name: /^План посадок/ });

    clickMap('TREE-1');

    const panel = await screen.findByRole('region', { name: 'Дерево' });
    expect(
      within(panel).getByText('Рядом нет ограничений из проверенных категорий'),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText(
        'Граница участка в чертеже не найдена: посадки размещены по всему газону',
      ),
    ).toBeInTheDocument();
    expect(within(panel).queryByText('Не проверялось')).not.toBeInTheDocument();
    // Ни газона, ни границы участка в данных нет — и строк для них нет.
    expect(screen.queryByRole('switch', { name: /^Газон/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Граница участка' })).not.toBeInTheDocument();
  });

  test('/explanation с добавочными полями из контракта разбирается как прежде', async () => {
    mockSinglePlanting({ zoneOverPlanting: false });
    server.use(
      http.get('/api/projects/:projectId/explanation', () =>
        HttpResponse.json([
          {
            id: 'TREE-1',
            plant_type: 'tree',
            rule_id: 'TREE_FILL_LAWN',
            rule_name_ru: 'Групповая/одиночная посадка на свободном газоне',
            x: 1,
            y: 2,
            checks: [
              {
                category: 'underground_utilities',
                subtype: 'gas',
                required_m: 1.5,
                actual_m: 3.2,
                citation: '743-ПП — газопровод',
              },
            ],
            // Поле, которого нет даже в контракте: клиент его пропускает.
            source_layer: 'ГАЗ',
          },
        ]),
      ),
    );
    renderProject(READY_ID);
    await screen.findByRole('region', { name: /^План посадок/ });

    clickMap('TREE-1');

    const panel = await screen.findByRole('region', { name: 'Дерево' });
    expect(
      within(panel).getByText('Групповая/одиночная посадка на свободном газоне'),
    ).toBeInTheDocument();
    expect(within(panel).getByText('В координатах чертежа: X 1,00 м, Y 2,00 м')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('посадка внутри зоны — предупреждение, источник не указан', async () => {
    serverMock.obstacles = false;
    mockSinglePlanting({ zoneOverPlanting: true });
    renderProject(READY_ID);
    await screen.findByRole('region', { name: /^План посадок/ });

    clickMap('TREE-1');

    const panel = await screen.findByRole('region', { name: 'Дерево' });
    const [check] = within(panel).getAllByRole('listitem');
    expect(check).toHaveTextContent('Тепловая сеть');
    expect(within(check ?? panel).getByRole('img', { name: 'Норма нарушена' })).toBeVisible();
    expect(check).toHaveTextContent('Посадка внутри зоны запрета — сообщите разработчикам');
    expect(check).toHaveTextContent('Норма не указана сервером');
    expect(lastDimensions()).toEqual([]);
  });
});

async function firstTreeCoordinates(): Promise<number[] | undefined> {
  const response = await fetch(`/api/projects/${READY_ID}/planting`);
  // Ответ мока соответствует PlantingFeatureCollection контракта: берутся только нужные поля.
  const { features } = (await response.json()) as {
    features: { geometry: { coordinates: number[] }; properties: { id: string } }[];
  };
  return features.find(({ properties }) => properties.id === FIRST_TREE)?.geometry.coordinates;
}

const renderRegister = async (id = READY_ID) => {
  renderWithProviders(routes, `/projects/${id}?view=register`);
  return screen.findByRole('table');
};

const shownRange = () => screen.getByText(/^Показано /).textContent;

describe('ведомость', () => {
  test('?view=register открывает ведомость; карта создаётся при первом показе плана', async () => {
    await renderRegister();

    expect(screen.getByRole('radio', { name: 'Ведомость' })).toBeChecked();
    expect(screen.queryByRole('region', { name: MAP_LABEL })).not.toBeInTheDocument();
    expect(fakeMap.addLayer).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('radio', { name: 'План' }));
    expect(await screen.findByRole('region', { name: MAP_LABEL })).toBeInTheDocument();
    expect(fakeMap.addLayer).toHaveBeenCalled();
    const layers = fakeMap.addLayer.mock.calls.length;

    // Дальше план скрывается, а не размонтируется: карта не пересоздаётся.
    await userEvent.click(screen.getByRole('radio', { name: 'Ведомость' }));
    await userEvent.click(screen.getByRole('radio', { name: 'План' }));
    expect(fakeMap.addLayer).toHaveBeenCalledTimes(layers);
  });

  test('сводка — счётчики по типам, правилам и зонам запрета', async () => {
    await renderRegister();

    expect(screen.getByText('Деревья — 19')).toBeInTheDocument();
    expect(screen.getByText('Кустарники — 19')).toBeInTheDocument();
    expect(screen.getByText(/^Рядовая\/аллейная посадка вдоль борта — \d+$/)).toBeInTheDocument();
    // Площадь — объединение зон: газон без разрешённой области.
    expect(
      screen.getByText(/^Для деревьев: 5 зон запрета, общая площадь [\d ]+ м²$/),
    ).toBeInTheDocument();
  });

  test('столбцы и строки: координаты с шестью знаками, координаты чертежа с двумя', async () => {
    await renderRegister();

    expect(screen.getAllByRole('columnheader').map(({ textContent }) => textContent)).toEqual([
      '№',
      'Идентификатор',
      'Тип',
      'Правило посадки',
      'Широта',
      'Долгота',
      'X чертежа, м',
      'Y чертежа, м',
    ]);
    const [, first] = screen.getAllByRole('row');
    const cells = within(first ?? document.body).getAllByRole('cell');
    expect(cells.map(({ textContent }) => textContent)).toEqual([
      '1',
      FIRST_TREE,
      'Дерево',
      'Рядовая/аллейная посадка вдоль борта',
      expect.stringMatching(/^55,759\d{3}$/),
      expect.stringMatching(/^37,645\d{3}$/),
      '3,00',
      '2,20',
    ]);
    expect(shownRange()).toBe('Показано 1–38 из 38');
  });

  test('фильтры по типу, правилу и идентификатору; пусто — «Сбросить фильтры»', async () => {
    await renderRegister();

    await userEvent.click(screen.getByRole('radio', { name: 'Кустарники' }));
    expect(shownRange()).toBe('Показано 1–19 из 19');

    await userEvent.click(screen.getByRole('radio', { name: 'Все' }));
    await userEvent.click(screen.getByLabelText('Правило посадки', { selector: 'input' }));
    await userEvent.click(
      await screen.findByRole('option', { name: 'Рядовая/аллейная посадка вдоль борта' }),
    );
    const byRule = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[3]?.textContent);
    expect(new Set(byRule)).toEqual(new Set(['Рядовая/аллейная посадка вдоль борта']));

    await userEvent.type(
      screen.getByLabelText('Идентификатор', { selector: 'input' }),
      'нет такой',
    );
    expect(screen.getByText('Нет посадок по выбранным условиям')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(shownRange()).toBe('Показано 1–38 из 38');
  });

  test('сортировка по заголовку — aria-sort и порядок строк', async () => {
    await renderRegister();
    const typeHeader = screen.getByRole('columnheader', { name: 'Тип' });
    const types = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[2]?.textContent);

    expect(screen.getByRole('columnheader', { name: '№' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await userEvent.click(within(typeHeader).getByRole('button'));
    expect(typeHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('columnheader', { name: '№' })).not.toHaveAttribute('aria-sort');
    expect(types()[0]).toBe('Дерево');

    await userEvent.click(within(typeHeader).getByRole('button'));
    expect(typeHeader).toHaveAttribute('aria-sort', 'descending');
    expect(types()[0]).toBe('Кустарник');
  });

  test('больше 50 посадок — страницы', async () => {
    server.use(
      http.get('/api/projects/:projectId/planting', () =>
        HttpResponse.json({
          type: 'FeatureCollection',
          metadata: { crs: 'EPSG:4326 (WGS84 lon/lat)' },
          features: Array.from({ length: 120 }, (_, index) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [37.6452 + index * 1e-5, 55.7593] },
            properties: {
              id: `TREE_FILL_LAWN-${String(index + 1).padStart(5, '0')}`,
              plant_type: 'tree',
              rule_id: 'TREE_FILL_LAWN',
            },
          })),
        }),
      ),
    );
    await renderRegister();

    expect(screen.getAllByRole('row')).toHaveLength(51);
    expect(shownRange()).toBe('Показано 1–50 из 120');
    await userEvent.click(screen.getByRole('button', { name: 'Страница 3' }));
    expect(shownRange()).toBe('Показано 101–120 из 120');
    expect(screen.getAllByRole('row')).toHaveLength(21);
  });

  test('строка ведёт на план: выбор посадки, камера и фокус', async () => {
    await renderRegister();
    fakeMap.getZoom.mockReturnValue(15);

    screen.getByRole('button', { name: `Показать на плане: ${FIRST_TREE}` }).focus();
    await userEvent.keyboard('{Enter}');

    expect(screen.getByRole('radio', { name: 'План' })).toBeChecked();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const panel = await screen.findByRole('region', { name: 'Дерево' });
    expect(within(panel).getByText(FIRST_TREE)).toBeInTheDocument();
    // Масштаб не мельче того, где видны подписи размеров (в Москве — 18-й).
    const [lon, lat] = (await firstTreeCoordinates()) ?? [];
    const options = fakeMap.easeTo.mock.lastCall?.[0];
    expect(options?.center).toEqual([lon, lat]);
    expect(options?.zoom).toBeCloseTo(dimensionLabelsMinZoom(lat ?? 0), 3);
    // Строка скрыта вместе с ведомостью: фокус — в панели посадки.
    expect(panel).toHaveFocus();
    // Размер карты уточняется до перехода: иначе центр считался бы по скрытому контейнеру.
    expect(fakeMap.resize.mock.invocationCallOrder[0]).toBeLessThan(
      fakeMap.easeTo.mock.invocationCallOrder[0] ?? 0,
    );
  });

  test('выключенный слой посадки включается при переходе из ведомости', async () => {
    renderProject(READY_ID);
    await userEvent.click(await screen.findByRole('switch', { name: 'Деревья, 19 деревьев' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Ведомость' }));

    await userEvent.click(screen.getByRole('button', { name: `Показать на плане: ${FIRST_TREE}` }));

    expect(await screen.findByRole('switch', { name: 'Деревья, 19 деревьев' })).toBeChecked();
  });

  test('фильтры ведомости переживают переход на план и обратно', async () => {
    await renderRegister();
    await userEvent.click(screen.getByRole('radio', { name: 'Кустарники' }));

    await userEvent.click(screen.getByRole('radio', { name: 'План' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Ведомость' }));

    expect(screen.getByRole('radio', { name: 'Кустарники' })).toBeChecked();
    expect(shownRange()).toBe('Показано 1–19 из 19');
  });

  test('без WebGL строки ведомости на план не ведут', async () => {
    mapMock.unavailable = true;
    renderProject(READY_ID);
    await screen.findByText('Карта недоступна в этом браузере. Показан план посадок.');

    await userEvent.click(screen.getByRole('radio', { name: 'Ведомость' }));

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Показать на плане: / })).not.toBeInTheDocument();
    expect(screen.getByRole('cell', { name: FIRST_TREE })).toBeInTheDocument();
  });

  test('«Скачать ведомость (CSV)» — все посадки, имя по проекту', async () => {
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:csv';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    await renderRegister();
    await userEvent.click(screen.getByRole('radio', { name: 'Кустарники' }));

    await userEvent.click(screen.getByRole('button', { name: 'Скачать ведомость (CSV)' }));

    const link = click.mock.contexts[0];
    if (!(link instanceof HTMLAnchorElement)) throw new Error('ожидалась ссылка');
    expect(link.download).toBe('Сквер на Покровке — ведомость посадок.csv');
    const bytes = new Uint8Array((await blobs[0]?.arrayBuffer()) ?? new ArrayBuffer(0));
    // BOM UTF-8: Blob.text() его срезает, поэтому проверяется по байтам.
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = new TextDecoder().decode(bytes).split('\r\n');
    expect(lines[0]).toBe(
      '№;Идентификатор;Тип;Правило посадки;Широта;Долгота;X чертежа, м;Y чертежа, м',
    );
    expect(lines[1]).toMatch(
      /^1;TREE_ROW_CURB-00001;Дерево;Рядовая\/аллейная посадка вдоль борта;55,759\d{3};37,645\d{3};3,00;2,20$/,
    );
    // Фильтр на выгрузку не влияет: 38 посадок, заголовок и пустая строка после CRLF.
    expect(lines).toHaveLength(40);
  });
});

describe('геопривязка в шапке', () => {
  test('проверена — число точек, невязки и пояснение', async () => {
    renderProject(READY_ID);

    await userEvent.click(
      await screen.findByRole('button', { name: 'Геопривязка: проверена по опорным точкам' }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Совпало: 3 опорные точки')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Невязка наибольшая 0,21 м, средняя 0,14 м'),
    ).toBeInTheDocument();
    expect(
      within(dialog)
        .getAllByRole('row')
        .slice(1)
        .map(({ textContent }) => textContent.replace(/\s/g, ' ')),
    ).toEqual(['12040,12 м', '12070,08 м', '13110,21 м']);
    expect(within(dialog).getByText(/^Невязка — расхождение/)).toBeInTheDocument();
  });

  test('без геопривязки — пояснение о плане в координатах чертежа', async () => {
    renderProject(NO_GEOREF_ID);

    await userEvent.click(await screen.findByRole('button', { name: 'Без геопривязки' }));

    expect(
      await screen.findByText(/^Чертёж не привязан к городу: план показан в координатах чертежа/),
    ).toBeInTheDocument();
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

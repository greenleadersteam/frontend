import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useEffect } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type * as Config from '@/shared/config';
import { buildZip, renderWithProviders, server } from '@/shared/lib/test';

import { ProjectNewPage } from './project-new-page';

// Сервер без optionalBbox: как задеплоенный бэкенд, который требует bbox_user.
vi.mock('@/shared/config', async (importOriginal) => ({
  ...(await importOriginal<typeof Config>()),
  useCapability: (name: string) => name !== 'optionalBbox',
}));

// Карта в jsdom не рисуется. Подмена — карта 1000 × 400 px, которая, как MapLibre, вписывает
// bounds по меньшей стороне. Начальный вид — центр Москвы, 0,04° по широте ≈ 4453 м: рамка
// 70 % высоты — 3117 × 3117 м.
const mapMock = vi.hoisted(() => ({ basemap: true, handlers: new Map<string, () => void>() }));
const LON_PER_M = 1 / 62_780;
const LAT_PER_M = 1 / 111_330;
const HALF_FRAME_M = (0.7 * 0.04) / LAT_PER_M / 2;
const fakeMapFor = ([west, south, east, north]: [number, number, number, number]) => {
  const centerLon = (west + east) / 2;
  const centerLat = (south + north) / 2;
  const metersPerPx = (north - south) / LAT_PER_M / 400;
  return {
    getContainer: () => ({ clientWidth: 1000, clientHeight: 400 }),
    unproject: ([x, y]: [number, number]) => ({
      lng: centerLon + (x - 500) * metersPerPx * LON_PER_M,
      lat: centerLat - (y - 200) * metersPerPx * LAT_PER_M,
    }),
    on: (event: string, handler: () => void) => {
      mapMock.handlers.set(event, handler);
    },
  };
};

type FakeMapViewProps = {
  bounds: [number, number, number, number];
  onReady: (map: ReturnType<typeof fakeMapFor>) => void;
  onBasemapResolved: (available: boolean) => void;
  children?: ReactNode;
};

vi.mock('@/shared/map', () => ({
  MapView: ({ bounds, onReady, onBasemapResolved, children }: FakeMapViewProps) => {
    useEffect(() => {
      onBasemapResolved(mapMock.basemap);
      if (mapMock.basemap) onReady(fakeMapFor(bounds));
      // Подмена создаёт «карту» один раз, как MapView.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- только при монтировании
    }, []);
    return <div>{children}</div>;
  },
}));

const DRAFT_ID = '9a1c3e5b7d2f4a6c8e0b2d4f6a8c1e3b';

const renderWizard = (path: string) =>
  renderWithProviders([{ path: '/projects/new', Component: ProjectNewPage }], path);

const chooseArchive = async () => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error('Нет поля выбора файла');
  const entries = [{ name: 'ГП/Генплан.dxf', data: '0\nSECTION' }];
  await userEvent.upload(input, new File([buildZip(entries)], 'site.zip'));
};

// Тело POST /projects: в нём bbox_user.
const createdBodies = () => {
  const bodies: unknown[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'POST' && new URL(request.url).pathname === '/api/projects') {
      void request
        .clone()
        .json()
        .then((body: unknown) => bodies.push(body));
    }
  });
  return bodies;
};

beforeEach(() => {
  mapMock.basemap = true;
  mapMock.handlers.clear();
});

afterEach(() => {
  server.events.removeAllListeners();
});

async function toSiteStep() {
  renderWizard('/projects/new');
  await userEvent.type(await screen.findByLabelText(/Название проекта/), 'Сквер');
  await userEvent.click(screen.getByRole('button', { name: 'Далее: участок' }));
}

test('новый проект: шаг «Участок» — рамка по центру карты, область в bbox_user', async () => {
  const bodies = createdBodies();
  await toSiteStep();

  expect(await screen.findByText(/^Область: 31\d\d × 31\d\d м$/)).toBeInTheDocument();
  expect(screen.getByText(/^Приблизьте карту к участку/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Далее: файлы' }));
  await chooseArchive();
  await userEvent.click(screen.getByRole('button', { name: 'Загрузить и обработать' }));

  await waitFor(() => {
    expect(bodies).toHaveLength(1);
  });
  // Рамка вокруг центра начального вида: по полрамки в каждую сторону, долгота первой.
  const [body] = bodies;
  expect(body).toMatchObject({
    name: 'Сквер',
    bbox_user: [
      expect.closeTo(37.62 - HALF_FRAME_M * LON_PER_M, 6),
      expect.closeTo(55.75 - HALF_FRAME_M * LAT_PER_M, 6),
      expect.closeTo(37.62 + HALF_FRAME_M * LON_PER_M, 6),
      expect.closeTo(55.75 + HALF_FRAME_M * LAT_PER_M, 6),
    ],
  });
});

test('без подложки — ручной ввод углов с проверкой диапазонов Москвы', async () => {
  mapMock.basemap = false;
  await toSiteStep();

  expect(
    await screen.findByText(
      'Подложка не загружена: выбрать область на карте нельзя. Введите координаты углов участка.',
    ),
  ).toBeInTheDocument();
  const next = screen.getByRole('button', { name: 'Далее: файлы' });
  expect(next).toBeDisabled();

  await userEvent.type(screen.getByLabelText('Широта юго-западного угла'), '59,9');
  await userEvent.type(screen.getByLabelText('Долгота юго-западного угла'), '30,3');
  await userEvent.type(screen.getByLabelText('Широта северо-восточного угла'), '59,91');
  await userEvent.type(screen.getByLabelText('Долгота северо-восточного угла'), '30,31');
  // Ошибка — после ухода из поля, а не на каждую цифру.
  await userEvent.tab();
  expect(await screen.findByText(/за пределы Москвы/)).toBeVisible();
  expect(next).toBeDisabled();
  expect(next).toHaveAccessibleDescription(/за пределы Москвы/);

  for (const [label, value] of [
    ['Широта юго-западного угла', '55,758'],
    ['Долгота юго-западного угла', '37,642'],
    ['Широта северо-восточного угла', '55,761'],
    ['Долгота северо-восточного угла', '37,648'],
  ] as const) {
    await userEvent.clear(screen.getByLabelText(label));
    await userEvent.type(screen.getByLabelText(label), value);
  }
  expect(await screen.findByText('Область: 377 × 334 м')).toBeInTheDocument();
  expect(next).toBeEnabled();
});

test('«Назад» с «Файлов» ведёт на «Участок» с той же областью, без сжатия рамкой', async () => {
  await toSiteStep();
  const before = (await screen.findByText(/^Область: /)).textContent;
  await userEvent.click(screen.getByRole('button', { name: 'Далее: файлы' }));

  await userEvent.click(await screen.findByRole('button', { name: 'Назад' }));

  expect(await screen.findByText(/^Приблизьте карту к участку/)).toBeInTheDocument();
  expect((await screen.findByText(/^Область: /)).textContent).toBe(before);
});

test('черновик из списка уже создан — шага «Участок» нет, загрузка доступна', async () => {
  renderWizard(`/projects/new?project=${DRAFT_ID}`);
  await screen.findByRole('heading', { level: 1 });
  await chooseArchive();

  expect(await screen.findByRole('button', { name: 'Загрузить и обработать' })).toBeEnabled();
  expect(screen.queryByText('Участок')).not.toBeInTheDocument();
});

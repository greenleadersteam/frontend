import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type * as Config from '@/shared/config';
import { renderWithProviders, server } from '@/shared/lib/test';

import type { PlaceTarget } from '../lib/show-place';
import { PlaceSearch } from './place-search';

const GEOCODER_URL = 'https://geocoder.test/search';
const configMock = vi.hoisted(() => ({ geocoder: null as Config.GeocoderConfig | null }));
vi.mock('@/shared/config', async (importOriginal) => {
  const actual = await importOriginal<typeof Config>();
  return {
    ...actual,
    getRuntimeConfig: () => ({ ...actual.getRuntimeConfig(), geocoder: configMock.geocoder }),
  };
});

const requests: URL[] = [];
const TVERSKAYA = {
  place_id: 101,
  display_name: 'Тверская улица, 13, Москва',
  lat: '55.761',
  lon: '37.609',
  boundingbox: ['55.7605', '55.7615', '37.6085', '37.6095'],
};

beforeEach(() => {
  requests.length = 0;
  configMock.geocoder = { url: GEOCODER_URL, attribution: 'Nominatim, данные © OpenStreetMap' };
  server.use(
    http.get(GEOCODER_URL, ({ request }) => {
      requests.push(new URL(request.url));
      return HttpResponse.json([
        TVERSKAYA,
        { place_id: 102, display_name: 'Тверская площадь', lat: '55.76', lon: '37.61' },
      ]);
    }),
  );
});

const renderSearch = () => {
  const onPick = vi.fn<(target: PlaceTarget) => void>();
  renderWithProviders([{ path: '/', element: <PlaceSearch onPick={onPick} /> }], '/');
  return { onPick, field: screen.getByRole('textbox', { name: 'Найти место на карте' }) };
};

describe('поиск места', () => {
  test('координаты разбираются локально: без запроса, карта — в точку', async () => {
    const { onPick, field } = renderSearch();

    await userEvent.type(field, '55°45′21″ 37°37′02″{Enter}');

    expect(requests).toHaveLength(0);
    const target = onPick.mock.lastCall?.[0];
    if (target?.kind !== 'point') throw new Error('ожидалась точка');
    expect(target.lat).toBeCloseTo(55.755833, 5);
    expect(target.lon).toBeCloseTo(37.617222, 5);
  });

  test('адрес ищется только по Enter, не на каждое нажатие; параметры Nominatim', async () => {
    const { field } = renderSearch();

    await userEvent.type(field, 'Тверская 13');
    expect(requests).toHaveLength(0);
    await userEvent.keyboard('{Enter}');

    expect(await screen.findByRole('option', { name: 'Тверская улица, 13, Москва' })).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({
      q: 'Тверская 13',
      format: 'jsonv2',
      'accept-language': 'ru',
      countrycodes: 'ru',
      viewbox: '36.6,54.95,38.2,56.2',
      bounded: '1',
      limit: '5',
    });
    expect(screen.getByText('Nominatim, данные © OpenStreetMap')).toBeVisible();
  });

  test('результат выбирается стрелками и Enter; охват — вписывается', async () => {
    const { onPick, field } = renderSearch();
    await userEvent.type(field, 'Тверская{Enter}');
    await screen.findByRole('option', { name: 'Тверская площадь' });

    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onPick).toHaveBeenCalledWith({ kind: 'point', lat: 55.76, lon: 37.61 });
    expect(field).toHaveValue('Тверская площадь');

    await userEvent.clear(field);
    await userEvent.type(field, 'Тверская 13{Enter}');
    await userEvent.click(
      await screen.findByRole('option', { name: 'Тверская улица, 13, Москва' }),
    );

    expect(onPick).toHaveBeenLastCalledWith({
      kind: 'bounds',
      bounds: [37.6085, 55.7605, 37.6095, 55.7615],
    });
  });

  test('без геокодера адрес не ищется — работают только координаты', async () => {
    configMock.geocoder = null;
    const { onPick, field } = renderSearch();
    expect(field).toHaveAttribute('placeholder', 'Координаты, например 55.7558, 37.6173');

    await userEvent.type(field, 'Тверская 13{Enter}');

    expect(requests).toHaveLength(0);
    expect(
      screen.getByText(
        'Поиск по адресу не настроен. Введите координаты, например 55.7558, 37.6173.',
      ),
    ).toBeInTheDocument();
    await userEvent.clear(field);
    await userEvent.type(field, '55.7558, 37.6173{Enter}');
    expect(onPick).toHaveBeenCalledWith({ kind: 'point', lat: 55.7558, lon: 37.6173 });
  });

  test('ошибка координат — под полем, запроса нет', async () => {
    const { onPick, field } = renderSearch();

    await userEvent.type(field, '95.1, 37.6{Enter}');

    expect(screen.getByText(/^Широта — от −90 до 90/)).toBeInTheDocument();
    expect(field).toHaveAccessibleDescription(/Широта — от −90 до 90/);
    expect(requests).toHaveLength(0);
    expect(onPick).not.toHaveBeenCalled();
  });

  test('вне карты Москвы: координаты — ошибка поля, найденные места — не в списке', async () => {
    server.use(
      http.get(GEOCODER_URL, () =>
        HttpResponse.json([
          { place_id: 7, display_name: 'Ленина, 5, Казань', lat: '55.79', lon: '49.12' },
          TVERSKAYA,
        ]),
      ),
    );
    const { onPick, field } = renderSearch();

    await userEvent.type(field, '59.93, 30.33{Enter}');
    expect(screen.getByText(/^Точка за пределами карты/)).toBeInTheDocument();
    expect(onPick).not.toHaveBeenCalled();

    await userEvent.clear(field);
    await userEvent.type(field, 'Ленина 5{Enter}');
    expect(await screen.findByRole('option', { name: 'Тверская улица, 13, Москва' })).toBeVisible();
    expect(screen.queryByRole('option', { name: 'Ленина, 5, Казань' })).not.toBeInTheDocument();
  });

  test('ответ на прежний запрос не открывает список под изменённой строкой', async () => {
    let answer: (() => void) | undefined;
    server.use(
      http.get(
        GEOCODER_URL,
        () =>
          new Promise<Response>((resolve) => {
            answer = () => {
              resolve(HttpResponse.json([TVERSKAYA]));
            };
          }),
      ),
    );
    const { field } = renderSearch();
    await userEvent.type(field, 'Тверская{Enter}');
    await waitFor(() => {
      expect(answer).toBeDefined();
    });

    await userEvent.type(field, ' 13{Enter}');
    // Второй запрос, пока идёт первый, не уходит — и это сказано, а не проглочено.
    expect(screen.getByText('Идёт поиск. Дождитесь ответа и нажмите Enter ещё раз.')).toBeVisible();
    answer?.();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  test('геокодер не ответил — объяснение, а не пустой список', async () => {
    server.use(http.get(GEOCODER_URL, () => new HttpResponse(null, { status: 503 })));
    const { field } = renderSearch();

    await userEvent.type(field, 'Тверская{Enter}');

    expect(
      await screen.findByText('Поиск по адресу не ответил. Проверьте сеть или введите координаты.'),
    ).toBeInTheDocument();
  });
});

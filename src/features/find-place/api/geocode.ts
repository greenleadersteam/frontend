import { z } from 'zod';

import { baseApi } from '@/shared/api';
import { BASEMAP_BOUNDS } from '@/shared/config';

export type Place = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  // Охват объекта [запад, юг, восток, север]: карта вписывает его, а не прыгает в точку.
  bounds: [number, number, number, number] | null;
};

type GeocodeArgs = { url: string; text: string };

const coordinate = z.string().transform(Number).pipe(z.number());

// Ответ Nominatim с format=jsonv2 — внешние данные: проверяются, прежде чем попасть на карту.
// boundingbox — [юг, север, запад, восток] строками.
const nominatimSchema = z.array(
  z.object({
    place_id: z.number(),
    display_name: z.string(),
    lat: coordinate,
    lon: coordinate,
    boundingbox: z.tuple([coordinate, coordinate, coordinate, coordinate]).optional(),
  }),
);

const RESULT_LIMIT = 5;

// Параметры по политике Nominatim: русские названия, поиск по России в охвате карты — Москва
// и Новая Москва с запасом (bounded=1). Иначе пять мест из лимита уходили бы на другие города.
export function geocodeUrl({ url, text }: GeocodeArgs): string {
  const request = new URL(url);
  request.search = new URLSearchParams({
    q: text,
    format: 'jsonv2',
    'accept-language': 'ru',
    countrycodes: 'ru',
    viewbox: BASEMAP_BOUNDS.join(','),
    bounded: '1',
    limit: String(RESULT_LIMIT),
  }).toString();
  return request.toString();
}

const geocodeApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // Результаты кешируются: повтор того же запроса не нагружает внешний сервис.
    geocode: build.query<Place[], GeocodeArgs>({
      queryFn: async (args, { signal }) => {
        let response: Response;
        try {
          response = await fetch(geocodeUrl(args), {
            signal,
            headers: { Accept: 'application/json' },
          });
        } catch {
          return { error: { status: 'FETCH_ERROR', error: 'геокодер не ответил' } };
        }
        if (!response.ok) return { error: { status: response.status, data: null } };
        const body: unknown = await response.json().catch(() => null);
        const parsed = nominatimSchema.safeParse(body);
        if (!parsed.success) {
          return {
            error: {
              status: 'PARSING_ERROR',
              originalStatus: response.status,
              data: '',
              error: 'ответ геокодера не в формате Nominatim',
            },
          };
        }
        return {
          data: parsed.data.map((item) => ({
            id: String(item.place_id),
            name: item.display_name,
            lat: item.lat,
            lon: item.lon,
            bounds:
              item.boundingbox === undefined
                ? null
                : [
                    item.boundingbox[2],
                    item.boundingbox[0],
                    item.boundingbox[3],
                    item.boundingbox[1],
                  ],
          })),
        };
      },
    }),
  }),
});

export const { useLazyGeocodeQuery } = geocodeApi;

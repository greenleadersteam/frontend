import { createLocalFrame } from '@/entities/project';

// Область участка в WGS84, градусы.
export type SiteArea = { west: number; south: number; east: number; north: number };

// bbox_user бэкенда — (minx, miny, maxx, maxy) в WGS84 lon/lat: долгота первой
// (../backend/greenplan/api/schemas.py:13-18, ../backend/greenplan/cli.py:70-78).
export const toBboxUser = ({
  west,
  south,
  east,
  north,
}: SiteArea): [number, number, number, number] => [west, south, east, north];

// Бэкенд размер области не ограничивает: она нужна, чтобы отличить геодезические пункты
// с одинаковыми номерами в каталоге geobridge.ru. Меньше 50 м по любой стороне в области почти
// нет пунктов сети, больше 5 км — номера начинают повторяться.
const MIN_SIDE_M = 50;
const MAX_SIDE_M = 5000;

// Москва с Новой Москвой по границе субъекта в OSM (shared/config/basemap.ts — с запасом).
const MOSCOW = { west: 36.8, south: 55.14, east: 37.97, north: 56.02 };

// Ширина и высота области в метрах — той же проекцией, что план посадок.
export function siteSize(area: SiteArea): { width: number; height: number } {
  const frame = createLocalFrame(
    { minX: area.west, minY: area.south, maxX: area.east, maxY: area.north },
    true,
  );
  const [west, south] = frame.toLocal([area.west, area.south]);
  const [east, north] = frame.toLocal([area.east, area.north]);
  return { width: east - west, height: north - south };
}

// Почему область не подходит; null — подходит. На карте область меняют масштабом, при ручном
// вводе — координатами углов.
export function siteProblem(area: SiteArea, input: 'map' | 'manual'): string | null {
  if (area.west >= area.east || area.south >= area.north) {
    return 'Юго-западный угол должен быть южнее и западнее северо-восточного.';
  }
  if (
    area.west < MOSCOW.west ||
    area.east > MOSCOW.east ||
    area.south < MOSCOW.south ||
    area.north > MOSCOW.north
  ) {
    return 'Область выходит за пределы Москвы. Проверьте широту и долготу углов.';
  }
  const { width, height } = siteSize(area);
  // Узкая полоса тоже мала: минимум — по меньшей стороне, максимум — по большей.
  if (Math.min(width, height) < MIN_SIDE_M) {
    return input === 'map'
      ? 'Область меньше 50\u00A0м. Отдалите карту: в области должны быть точки геодезической сети.'
      : 'Область меньше 50\u00A0м. Раздвиньте углы: в области должны быть точки геодезической сети.';
  }
  if (Math.max(width, height) > MAX_SIDE_M) {
    return input === 'map'
      ? 'Область больше 5\u00A0км. Приблизьте карту к участку.'
      : 'Область больше 5\u00A0км. Сдвиньте углы ближе к участку.';
  }
  return null;
}

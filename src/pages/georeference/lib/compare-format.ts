import { DASH, formatDecimal } from '@/shared/lib/georeference';

const NBSP = '\u00A0';

// Разница масштаба текущей привязки относительно эталона: меньше тысячной — в миллионных долях,
// иначе в процентах; знак «+» у увеличения (прототип, ../geojson/js/ui.js:640-649).
export function formatRelative(rel: number): string {
  if (!Number.isFinite(rel)) return DASH;
  if (rel === 0) return '0';
  const sign = rel > 0 ? '+' : '';
  if (Math.abs(rel) < 1e-3) {
    const ppm = rel * 1e6;
    return `${sign}${formatDecimal(ppm, Math.abs(ppm) < 10 ? 2 : 0)}${NBSP}млн⁻¹`;
  }
  return `${sign}${formatDecimal(rel * 100, 2)}${NBSP}%`;
}

// «2026-09-23T23:35:37 UTC+03:00» → «23.09.2026 в 23:35:37». Секунды обязательны: JSON и geojson
// одной привязки различаются только ими. Дата приходит из файла — недоверенная строка: всё, что
// не похоже на штамп выгрузки, показывается как есть, текстом.
export function formatCreated(created: string | null): string {
  if (created === null) return 'дата неизвестна';
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(created);
  if (match === null) return created;
  const [, year, month, day, hours, minutes, seconds] = match;
  return `${String(day)}.${String(month)}.${String(year)} в ${String(hours)}:${String(minutes)}:${String(seconds)}`;
}

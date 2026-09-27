import { numberFormat } from '../format';

// Форматирование чисел модуля геопривязки. Перенесено из прототипа ../geojson/js/ns.js:33-112;
// разряды — по правилу продукта (copy.md): «5000», но «12 345». Точность задаёт вызывающая
// сторона — так выглядят координаты, допуски и масштабы в панели привязки.

const NBSP = '\u00A0';
export const DASH = '—';

const formatters = new Map<number, ReturnType<typeof numberFormat>>();

function formatter(digits: number): ReturnType<typeof numberFormat> {
  let found = formatters.get(digits);
  if (found === undefined) {
    found = numberFormat({ minimumFractionDigits: digits, maximumFractionDigits: digits });
    formatters.set(digits, found);
  }
  return found;
}

// formatDecimal(1234.5, 1) → «1 234,5». Минус — знак минуса, а не дефис; число, которое
// округлилось в ноль, минуса не получает.
//
// Округляет toFixed, как в прототипе: по точному двоичному значению. Intl округляет по кратчайшей
// десятичной записи, и на «половинках» вроде 1845018.0394575 последний знак расходится. Поэтому
// Intl получает уже округлённое число и только раскладывает его по разрядам. До 15 значащих
// цифр такое число записывается ровно теми же цифрами, и Intl их не меняет.
export function formatDecimal(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return DASH;
  const rounded = Number(Math.abs(value).toFixed(digits));
  const body = formatter(digits).format(rounded);
  return value < 0 && rounded !== 0 ? `−${body}` : body;
}

// formatLength(342.5) → «342,5 м». Без явной точности она подбирается по величине.
export function formatLength(meters: number, digits?: number): string {
  if (!Number.isFinite(meters)) return DASH;
  const abs = Math.abs(meters);
  const auto = abs < 10 ? 2 : abs < 1000 ? 1 : 0;
  return `${formatDecimal(meters, digits ?? auto)}${NBSP}м`;
}

// formatDegrees(42.5) → «42,5°»: знак градуса примыкает к числу.
export function formatDegrees(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return DASH;
  return `${formatDecimal(value, digits)}°`;
}

// formatLatLon(55.751244, 37.618423) → «55,751244° с. ш., 37,618423° в. д.»
export function formatLatLon(lat: number, lon: number, digits = 6): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return DASH;
  const ns = lat < 0 ? `ю.${NBSP}ш.` : `с.${NBSP}ш.`;
  const ew = lon < 0 ? `з.${NBSP}д.` : `в.${NBSP}д.`;
  return `${formatDecimal(Math.abs(lat), digits)}°${NBSP}${ns}, ${formatDecimal(Math.abs(lon), digits)}°${NBSP}${ew}`;
}

// formatMapScale(5000) → «1:5 000»
export function formatMapScale(denominator: number): string {
  if (!Number.isFinite(denominator) || denominator <= 0) return DASH;
  return `1:${formatDecimal(Math.round(denominator), 0)}`;
}

// formatMetersPerPixel(0.298) → «0,30 м/пикс»
export function formatMetersPerPixel(metersPerPixel: number): string {
  if (!Number.isFinite(metersPerPixel)) return DASH;
  const abs = Math.abs(metersPerPixel);
  const digits = abs < 1 ? 2 : abs < 100 ? 1 : 0;
  return `${formatDecimal(metersPerPixel, digits)}${NBSP}м/пикс`;
}

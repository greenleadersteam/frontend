// Форматирование чисел модуля геопривязки. Перенесено из прототипа ../geojson/js/ns.js:33-112.
// Отличие от shared/lib/format: разряды отделяются и у четырёхзначных чисел («5 000»), а точность
// задаёт вызывающая сторона — так выглядят координаты, допуски и масштабы в панели привязки.

const NBSP = '\u00A0';
export const DASH = '—';

const formatters = new Map<number, Intl.NumberFormat>();

function formatter(digits: number): Intl.NumberFormat {
  let found = formatters.get(digits);
  if (found === undefined) {
    found = new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping: 'always',
    });
    formatters.set(digits, found);
  }
  return found;
}

// formatDecimal(1234.5, 1) → «1 234,5». Минус — знак минуса, а не дефис; число, которое
// округлилось в ноль, минуса не получает.
//
// Округляет toFixed, как в прототипе: по точному двоичному значению. Intl округляет по кратчайшей
// десятичной записи, и на «половинках» вроде 1845018.0394575 последний знак расходится. Поэтому
// Intl получает уже округлённую строку — её он читает как точное десятичное число — и только
// раскладывает её по разрядам.
export function formatDecimal(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return DASH;
  // toFixed конечного числа всегда даёт числовую запись: «1234.50» или «1e+21».
  const rounded = Math.abs(value).toFixed(digits) as `${number}`;
  const body = formatter(digits)
    .formatToParts(rounded)
    .map((part) => {
      switch (part.type) {
        case 'group':
          return NBSP;
        case 'decimal':
          return ',';
        default:
          return part.value;
      }
    })
    .join('');
  return value < 0 && Number(rounded) !== 0 ? `−${body}` : body;
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

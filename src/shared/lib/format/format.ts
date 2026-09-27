const LOCALE = 'ru-RU';
const NBSP = '\u00A0';

const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const twoDigits = new Intl.NumberFormat(LOCALE, { minimumIntegerDigits: 2 });

// Intl.DurationFormat не используется: его нет в Firefox ESR 128 и в lib ES2023 TypeScript.
// Формат — как в design.md: «3 мин 12 с», «48 с», «1 ч 05 мин»; число и единица через U+00A0.
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${integer.format(hours)}${NBSP}ч ${twoDigits.format(minutes)}${NBSP}мин`;
  }
  if (minutes > 0) {
    const whole = `${integer.format(minutes)}${NBSP}мин`;
    return seconds === 0 ? whole : `${whole} ${integer.format(seconds)}${NBSP}с`;
  }
  return `${integer.format(seconds)}${NBSP}с`;
}

const dayMonth = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long' });
const dayMonthYear = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

// Год пишется только для прошлых лет: «26 сентября», «3 марта 2025 г.».
export function formatDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  return date.getFullYear() === now.getFullYear()
    ? dayMonth.format(date)
    : dayMonthYear.format(date);
}

const MEBIBYTE = 2 ** 20;
const KIBIBYTE = 2 ** 10;
const oneDecimal = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });

// Размеры в двоичных единицах, подписанных «МБ» и «КБ» (copy.md), как лимит бэкенда в МиБ.
// Мелкие файлы — в КБ, чтобы список файлов архива не пестрел «0 МБ».
export function formatFileSize(bytes: number): string {
  // 1023,9 КБ и больше показываются как 1 МБ, а не «1 024 КБ».
  if (Math.ceil(bytes / KIBIBYTE) < 1024) {
    return `${integer.format(Math.ceil(bytes / KIBIBYTE))}${NBSP}КБ`;
  }
  return `${oneDecimal.format(bytes / MEBIBYTE)}${NBSP}МБ`;
}

// «61 из 102 МБ»: единица одна на пару и выбирается по общему размеру. Отправленное
// округляется вниз, чтобы «62 из 62» не появилось раньше конца; в конце числа совпадают.
export function formatTransferred(sent: number, total: number): string {
  const unit = total < MEBIBYTE ? { size: KIBIBYTE, label: 'КБ' } : { size: MEBIBYTE, label: 'МБ' };
  const shownTotal = Math.round(total / unit.size);
  const shownSent = sent >= total ? shownTotal : Math.min(Math.floor(sent / unit.size), shownTotal);
  return `${integer.format(shownSent)} из ${integer.format(shownTotal)}${NBSP}${unit.label}`;
}

const pluralRules = new Intl.PluralRules(LOCALE);

type CountForms = { one: string; few: string; many: string };

// Формы слова задаёт вызывающий код: «1 проект», «3 проекта», «11 проектов».
export function formatCount(count: number, forms: CountForms): string {
  const category = pluralRules.select(count);
  const word = category === 'one' ? forms.one : category === 'few' ? forms.few : forms.many;
  return `${integer.format(count)} ${word}`;
}

// Счётчики на карте: «1 204» с неразрывным пробелом между разрядами.
export const formatNumber = (value: number): string => integer.format(value);

const meters = {
  1: new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }),
  2: new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }),
};

// Расстояния хранятся в метрах числом (api.md): «1,5 м», «0,35 м». Подписи на карте — с одним
// знаком: «2,3 м».
export const formatMeters = (value: number, fractionDigits: 1 | 2 = 2): string =>
  `${meters[fractionDigits].format(value)}${NBSP}м`;

const squareMeters = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

// Площадь зоны: «1 240 м²».
export const formatSquareMeters = (value: number): string =>
  `${squareMeters.format(value)}${NBSP}м²`;

const coordinate = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 6,
  maximumFractionDigits: 6,
  useGrouping: false,
});

// Широта и долгота с точностью ~0,1 м: «55,759312».
export const formatCoordinate = (value: number): string => coordinate.format(value);

// signDisplay 'negative': бэкенд округляет -0,004 до -0.0, а «-0,00» на чертеже читается как
// ошибка.
const drawingMeters = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
  signDisplay: 'negative',
});

// Координата чертежа в метрах, как в CAD — без разрядов: «-1499,26».
export const formatDrawingCoordinate = (value: number): string => drawingMeters.format(value);

// Та же координата с единицей: «-1499,26 м».
export const formatDrawingMeters = (value: number): string =>
  `${drawingMeters.format(value)}${NBSP}м`;

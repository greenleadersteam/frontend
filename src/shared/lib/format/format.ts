const LOCALE = 'ru-RU';
const NBSP = '\u00A0';

type NumberFormat = { format: (value: number) => string };

// Разряды по copy.md: четырёхзначное число без пробела («5000»), с пяти знаков в целой части —
// группы через неразрывный пробел («12 345»). Порог задаётся здесь, а не локалью: ru-RU в
// CLDR 47 (Node 24, свежие браузеры) группирует и «5 000», в старых версиях — нет. Так правило
// одно во всех движках и не зависит от useGrouping из Intl.NumberFormat v3.
export function numberFormat(options: Intl.NumberFormatOptions): NumberFormat {
  const plain = new Intl.NumberFormat(LOCALE, { ...options, useGrouping: false });
  const grouped = new Intl.NumberFormat(LOCALE, { ...options, useGrouping: true });
  return {
    format: (value) => {
      const integerDigits = plain
        .formatToParts(value)
        .filter(({ type }) => type === 'integer')
        .reduce((count, { value: digits }) => count + digits.length, 0);
      return integerDigits >= 5 ? grouped.format(value) : plain.format(value);
    },
  };
}

const integer = numberFormat({ maximumFractionDigits: 0 });
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

const dateTime = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Дата с годом и временем — для документов, которые читают позже: «27 сентября 2026 г. в 16:05».
export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));

const MEBIBYTE = 2 ** 20;
const KIBIBYTE = 2 ** 10;
const oneDecimal = numberFormat({ maximumFractionDigits: 1 });

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

// Счётчики на карте: «1204», «12 048» — разряды с пяти знаков через неразрывный пробел.
export const formatNumber = (value: number): string => integer.format(value);

const meters = {
  1: numberFormat({ maximumFractionDigits: 1 }),
  2: numberFormat({ maximumFractionDigits: 2 }),
};

// Расстояния хранятся в метрах числом (api.md): «1,5 м», «0,35 м». Подписи на карте — с одним
// знаком: «2,3 м». Меньше шага округления — «менее 0,1 м», а не «0 м»: ноль читался бы как
// посадка на самой кромке.
export function formatMeters(value: number, fractionDigits: 1 | 2 = 2): string {
  const step = 10 ** -fractionDigits;
  return value < step
    ? `менее ${meters[fractionDigits].format(step)}${NBSP}м`
    : `${meters[fractionDigits].format(value)}${NBSP}м`;
}

const squareMeters = numberFormat({ maximumFractionDigits: 0 });

// Площадь зоны: «1 240 м²»; крошечный обрезок — «менее 1 м²».
export const formatSquareMeters = (value: number): string =>
  value < 1 ? `менее 1${NBSP}м²` : `${squareMeters.format(value)}${NBSP}м²`;

const percent = new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 0 });

// Доля от 0 до 1: «28 %» — ru-RU сам ставит неразрывный пробел перед знаком процента.
export const formatPercent = (share: number): string => percent.format(share);

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

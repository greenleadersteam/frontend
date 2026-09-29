export type ParsedQuery =
  | { kind: 'coordinates'; lat: number; lon: number }
  | { kind: 'address'; text: string }
  | { kind: 'error'; message: string };

export const COORDINATES_EXAMPLE = '55.7558, 37.6173';

// Буквы полушарий по-латински и по-русски: С/Ю — широта, В/З — долгота.
const LATITUDE_LETTERS = 'NSСЮ';
const NEGATIVE_LETTERS = 'SWЮЗ';
const LETTERS = 'NSEWСЮВЗ';

// Одна координата: знак, градусы, при необходимости минуты и секунды, буква полушария до или
// после. Десятичный знак — точка или запятая.
const NUMBER = String.raw`\d+(?:[.,]\d+)?`;
const COORDINATE = String.raw`([${LETTERS}])?\s*(-)?(${NUMBER})(?:\s*°(?:\s*(${NUMBER})\s*')?(?:\s*(${NUMBER})\s*")?)?\s*([${LETTERS}])?`;
// Между координатами — «;», запятая с пробелами или без, либо пробелы.
const PAIR = new RegExp(String.raw`^${COORDINATE}\s*(?:[;,]\s*|\s+)${COORDINATE}$`, 'iu');

// Только цифры, знаки градусов, разделители и буквы полушарий: такой ввод — координаты, и
// ошибка в нём — ошибка координат, а не адрес.
const LOOKS_LIKE_COORDINATES = new RegExp(String.raw`^[\d\s.,;°'"+\-${LETTERS}]+$`, 'iu');

const toNumber = (text: string | undefined): number =>
  text === undefined ? 0 : Number(text.replace(',', '.'));

type Coordinate = { value: number; letter: string | null };

function coordinate(parts: (string | undefined)[]): Coordinate | { error: string } {
  const [before, minus, degreesText, minutesText, secondsText, after] = parts;
  const letter = (before ?? after)?.toUpperCase() ?? null;
  const minutes = toNumber(minutesText);
  const seconds = toNumber(secondsText);
  if (minutes >= 60 || seconds >= 60) {
    return { error: 'Минуты и секунды должны быть меньше 60.' };
  }
  const value = toNumber(degreesText) + minutes / 60 + seconds / 3600;
  const negative = minus !== undefined || (letter !== null && NEGATIVE_LETTERS.includes(letter));
  return { value: negative ? -value : value, letter };
}

const isLatitudeLetter = (letter: string | null) =>
  letter !== null && LATITUDE_LETTERS.includes(letter);

// Разбор строки поиска: пара координат — локально, без сети; остальное — адрес для геокодера.
// Порядок — широта, долгота, как в Яндекс Картах и на геодезических планах; буквы полушарий
// позволяют написать долготу первой.
export function parseQuery(input: string): ParsedQuery {
  const text = input.trim().replace(/[′’]/g, "'").replace(/[″”]/g, '"').replace(/[−–]/g, '-');
  if (text === '') return { kind: 'error', message: 'Введите адрес или координаты.' };
  if (!LOOKS_LIKE_COORDINATES.test(text)) return { kind: 'address', text };

  const match = PAIR.exec(text);
  if (match === null) {
    return {
      kind: 'error',
      message: `Не получилось разобрать координаты. Введите широту и долготу, например ${COORDINATES_EXAMPLE}.`,
    };
  }
  const first = coordinate(match.slice(1, 7));
  const second = coordinate(match.slice(7, 13));
  if ('error' in first) return { kind: 'error', message: first.error };
  if ('error' in second) return { kind: 'error', message: second.error };

  const lonFirst = second.letter !== null && isLatitudeLetter(second.letter);
  const [lat, lon] = lonFirst ? [second.value, first.value] : [first.value, second.value];
  if (Math.abs(lat) > 90) {
    return {
      kind: 'error',
      message: `Широта — от −90 до 90. Сначала широта, потом долгота: ${COORDINATES_EXAMPLE}.`,
    };
  }
  if (Math.abs(lon) > 180) {
    return { kind: 'error', message: 'Долгота — от −180 до 180.' };
  }
  return { kind: 'coordinates', lat, lon };
}

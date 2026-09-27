import type { Contour } from './contour';

// Диагностика единиц после загрузки. Перенесено из прототипа ../geojson/js/store.js:271-329
// и ../geojson/js/export.js:14-22 без изменений порогов и текстов.

export type Warning = { level: 'danger' | 'warning'; text: string };

// Главная проверка после загрузки — габарит в метрах: по нему сразу видно, метры в файле или
// миллиметры.
export function diagnose({ bbox }: Contour): Warning[] {
  const { width, height } = bbox;
  const warnings: Warning[] = [];

  const looksLikeDegrees =
    width < 1 &&
    height < 1 &&
    Math.abs(bbox.minX) <= 180 &&
    Math.abs(bbox.maxX) <= 180 &&
    Math.abs(bbox.minY) <= 90 &&
    Math.abs(bbox.maxY) <= 90;

  if (looksLikeDegrees) {
    warnings.push({
      level: 'danger',
      text:
        'Координаты похожи на градусы, а не на метры: габарит меньше единицы, значения ' +
        'укладываются в ±180 и ±90. Инструмент ждёт файл в метрах местной системы координат. ' +
        'Если это результат привязки из этого приложения — загрузите его как эталонный слой.',
    });
  }
  if (width > 500_000 || height > 500_000) {
    warnings.push({
      level: 'warning',
      text:
        'Габарит больше 500\u00A0км. Похоже, в файле не площадка, а несколько разнесённых ' +
        'объектов или другие единицы.',
    });
  }
  if (width < 1e-9 || height < 1e-9) {
    warnings.push({
      level: 'warning',
      text:
        'Габарит вырожден по одной из осей: все вершины лежат на прямой. Повернуть и вписать ' +
        'такой контур не выйдет.',
    });
  }
  return warnings;
}

// Подсказка про миллиметры — вопрос, а не диагноз. Габарит 50 000 единиц — это и область
// в 50 км в метрах, и участок в 50 м в миллиметрах; по одному числу их не различить. Подсказка
// нужна там, где миллиметры правдоподобны: большая сторона от 10 000 до 5 000 000 единиц и после
// деления на 1000 похожа на участок (от 10 м до 5 км). От 500 000 единиц одновременно
// срабатывает предупреждение про габарит больше 500 км — подсказка дополняет его конкретным
// вариантом.
const MM_MIN_UNITS = 10_000;
const MM_MAX_UNITS = 5_000_000;
const MM_MIN_SITE = 10;
const MM_MAX_SITE = 5000;

export type MillimetreHint = {
  side: number;
  width: number;
  height: number;
  mmWidth: number;
  mmHeight: number;
};

export function millimetreHint({ bbox }: Contour): MillimetreHint | null {
  const { width, height } = bbox;
  const side = Math.max(width, height);
  if (side < MM_MIN_UNITS || side > MM_MAX_UNITS) return null;
  if (side / 1000 < MM_MIN_SITE || side / 1000 > MM_MAX_SITE) return null;
  return { side, width, height, mmWidth: width / 1000, mmHeight: height / 1000 };
}

// Единицы файла: подпись и множитель «метров в единице файла». У «другое» множителя нет:
// его вводит пользователь.
export const UNITS = [
  { id: 'm', title: 'метры', scale: 1 },
  { id: 'cm', title: 'сантиметры', scale: 0.01 },
  { id: 'mm', title: 'миллиметры', scale: 0.001 },
  { id: 'ft', title: 'футы', scale: 0.3048 },
  { id: 'in', title: 'дюймы', scale: 0.0254 },
  { id: 'other', title: 'другое', scale: null },
] as const;

export type Unit = (typeof UNITS)[number];

import { expect, it } from 'vitest';

import { GEOREFERENCE_SAMPLE, portedGroup } from '@/shared/lib/test';

import {
  DASH,
  formatDecimal,
  formatDegrees,
  formatLatLon,
  formatLength,
  formatMapScale,
  formatMetersPerPixel,
} from './format';

// Группа «Форматирование и конфигурация» прототипа (../geojson/tests.html:288-384): 28 проверок.
// Перенесены 12 проверок форматирования и «образец контура замкнут». 15 проверок конфигурации
// подложек прототипа (Яндекс, Esri, статус доступности) относятся к карте и переносятся в Г2.
const NBSP = '\u00A0';
const { check } = portedGroup(13);

check('num: разряды неразрывным пробелом', () => {
  expect(formatDecimal(1234567.5, 1)).toBe(`1${NBSP}234${NBSP}567,5`);
});
check('num: четырёхзначное тоже с разрядом', () => {
  expect(formatDecimal(5000, 0)).toBe(`5${NBSP}000`);
});
check('num: десятичная запятая', () => {
  expect(formatDecimal(0.5, 2)).toBe('0,50');
});
check('num: минус без потери нуля', () => {
  expect(formatDecimal(-12.34, 1)).toBe('−12,3');
});
check('num: не число', () => {
  expect(formatDecimal(NaN, 2)).toBe(DASH);
});
check('len: единица через неразрывный пробел', () => {
  expect(formatLength(342.5)).toBe(`342,5${NBSP}м`);
});
check('len: тысячи метров без дробной части', () => {
  expect(formatLength(5000)).toBe(`5${NBSP}000${NBSP}м`);
});
check('deg: градус примыкает к числу', () => {
  expect(formatDegrees(42.5)).toBe('42,5°');
});
check('latlon: шесть знаков и полушария', () => {
  expect(formatLatLon(55.751244, 37.618423)).toBe(
    `55,751244°${NBSP}с.${NBSP}ш., 37,618423°${NBSP}в.${NBSP}д.`,
  );
});
check('latlon: южная и западная', () => {
  expect(formatLatLon(-33.86882, -70.5)).toBe(
    `33,868820°${NBSP}ю.${NBSP}ш., 70,500000°${NBSP}з.${NBSP}д.`,
  );
});
check('scale: знаменатель с разрядами', () => {
  expect(formatMapScale(5000)).toBe(`1:5${NBSP}000`);
});
check('mpp: метры на пиксель', () => {
  expect(formatMetersPerPixel(0.298)).toBe(`0,30${NBSP}м/пикс`);
});
check('образец контура замкнут', () => {
  const outer = GEOREFERENCE_SAMPLE.geojson.geometry.coordinates[0] ?? [];
  expect(outer).not.toHaveLength(0);
  expect(outer[0]).toEqual(outer.at(-1));
});

// Сверх переноса: прототип округляет toFixed по двоичному значению, Intl — по кратчайшей
// десятичной записи. На «половинке» они расходятся в последнем знаке.
it('formatDecimal округляет как прототип и на «половинке»', () => {
  expect(formatDecimal(1845018.0394575, 6)).toBe('1\u00A0845\u00A0018,039457');
});

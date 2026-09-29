import { describe, expect, test } from 'vitest';

import {
  formatCoordinate,
  formatCount,
  formatDate,
  formatDrawingCoordinate,
  formatDrawingMeters,
  formatDuration,
  formatFileSize,
  formatMeters,
  formatNumber,
  formatPercent,
  formatSquareMeters,
  formatTransferred,
  sentence,
} from './format';

const NBSP = '\u00A0';

describe('formatDuration', () => {
  test.each([
    [0, `0${NBSP}с`],
    [48_000, `48${NBSP}с`],
    [48_400, `48${NBSP}с`],
    [59_600, `1${NBSP}мин`],
    [180_000, `3${NBSP}мин`],
    [192_000, `3${NBSP}мин 12${NBSP}с`],
    [3_900_000, `1${NBSP}ч 05${NBSP}мин`],
    [3_600_000, `1${NBSP}ч 00${NBSP}мин`],
    [10 * 3_600_000 + 42 * 60_000 + 30_000, `10${NBSP}ч 42${NBSP}мин`],
    [-500, `0${NBSP}с`],
  ])('%i мс — «%s»', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe('formatDate', () => {
  const now = new Date(2026, 8, 26, 12);

  test('текущий год — без года', () => {
    expect(formatDate(new Date(2026, 8, 26, 9).toISOString(), now)).toBe('26 сентября');
  });

  test('прошлый год — с годом', () => {
    expect(formatDate(new Date(2025, 2, 3, 9).toISOString(), now)).toMatch(/^3 марта 2025/);
  });
});

describe('formatFileSize', () => {
  test.each([
    [100, `1${NBSP}КБ`],
    [340 * 1024, `340${NBSP}КБ`],
    [2 ** 20, `1${NBSP}МБ`],
    [2 ** 20 - 1, `1${NBSP}МБ`],
    [104_857_600, `100${NBSP}МБ`],
    [12.34 * 2 ** 20, `12,3${NBSP}МБ`],
  ])('%i байт — «%s»', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });
});

describe('formatTransferred', () => {
  test('«61 из 102 МБ»', () => {
    expect(formatTransferred(61.2 * 2 ** 20, 101.6 * 2 ** 20)).toBe(`61 из 102${NBSP}МБ`);
  });

  test('до конца загрузки отправленное не догоняет общее', () => {
    expect(formatTransferred(61.6 * 2 ** 20, 61.7 * 2 ** 20)).toBe(`61 из 62${NBSP}МБ`);
  });

  test('в конце загрузки числа совпадают', () => {
    expect(formatTransferred(61.7 * 2 ** 20, 61.7 * 2 ** 20)).toBe(`62 из 62${NBSP}МБ`);
  });

  test('архив меньше 1 МБ — в КБ', () => {
    expect(formatTransferred(300 * 1024, 800 * 1024)).toBe(`300 из 800${NBSP}КБ`);
  });
});

describe('formatCount', () => {
  const forms = { one: 'проект', few: 'проекта', many: 'проектов' };

  test.each([
    [0, '0 проектов'],
    [1, '1 проект'],
    [3, '3 проекта'],
    [5, '5 проектов'],
    [11, '11 проектов'],
    [21, '21 проект'],
    [22, '22 проекта'],
    [111, '111 проектов'],
  ])('%i — «%s»', (count, expected) => {
    expect(formatCount(count, forms)).toBe(expected);
  });
});

test('formatNumber — разряды с пяти знаков через неразрывный пробел, четырёхзначное слитно', () => {
  expect(formatNumber(1204)).toBe('1204');
  expect(formatNumber(9999)).toBe('9999');
  expect(formatNumber(12048)).toBe('12\u00A0048');
  expect(formatNumber(1234567)).toBe('1\u00A0234\u00A0567');
  expect(formatNumber(-12048)).toBe('-12\u00A0048');
  expect(formatNumber(24)).toBe('24');
});

test('порог разрядов — по округлённому числу: 9999,6 м² — это «10 000»', () => {
  expect(formatSquareMeters(9999.6)).toBe('10\u00A0000\u00A0м²');
  expect(formatSquareMeters(9999.4)).toBe('9999\u00A0м²');
});

test('formatMeters — запятая и неразрывный пробел перед «м»', () => {
  expect(formatMeters(1.5)).toBe('1,5\u00A0м');
  expect(formatMeters(0.35)).toBe('0,35\u00A0м');
  expect(formatMeters(12)).toBe('12\u00A0м');
});

test('formatMeters с одним знаком — подписи на карте', () => {
  expect(formatMeters(2.34, 1)).toBe(`2,3${NBSP}м`);
  expect(formatMeters(2.0, 1)).toBe(`2${NBSP}м`);
});

test('меньше шага округления — «менее», а не ноль', () => {
  expect(formatMeters(0.04, 1)).toBe(`менее 0,1${NBSP}м`);
  expect(formatMeters(0, 1)).toBe(`менее 0,1${NBSP}м`);
  expect(formatMeters(0.1, 1)).toBe(`0,1${NBSP}м`);
  expect(formatMeters(0.004)).toBe(`менее 0,01${NBSP}м`);
  expect(formatSquareMeters(0.4)).toBe(`менее 1${NBSP}м²`);
  expect(formatSquareMeters(1)).toBe(`1${NBSP}м²`);
});

test('formatSquareMeters — разряды и единица через неразрывный пробел', () => {
  expect(formatSquareMeters(1240.4)).toBe(`1240${NBSP}м²`);
  expect(formatSquareMeters(12400.4)).toBe(`12${NBSP}400${NBSP}м²`);
  expect(formatSquareMeters(80)).toBe(`80${NBSP}м²`);
});

test('formatCoordinate — шесть знаков, без разрядов', () => {
  expect(formatCoordinate(55.7593124)).toBe('55,759312');
  expect(formatCoordinate(37.6)).toBe('37,600000');
});

test('координата чертежа — два знака, без разрядов, без «-0,00»', () => {
  expect(formatDrawingCoordinate(-1499.264)).toBe('-1499,26');
  expect(formatDrawingCoordinate(-0.004)).toBe('0,00');
  expect(formatDrawingMeters(-1499.264)).toBe(`-1499,26${NBSP}м`);
});

test('доля — процентом без дробной части, с неразрывным пробелом', () => {
  expect(formatPercent(0.284)).toBe('28\u00A0%');
  expect(formatPercent(0)).toBe('0\u00A0%');
});

describe('sentence', () => {
  test('точка — только если знака конца ещё нет', () => {
    expect(sentence('Для кустарника норма не установлена')).toBe(
      'Для кустарника норма не установлена.',
    );
    expect(sentence('Норма не установлена.')).toBe('Норма не установлена.');
    expect(sentence('Норма не установлена. ')).toBe('Норма не установлена.');
    expect(sentence('Так ли?')).toBe('Так ли?');
    expect(sentence('и т. д…')).toBe('и т. д…');
  });
});

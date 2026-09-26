import { describe, expect, test } from 'vitest';

import {
  formatCount,
  formatDate,
  formatDuration,
  formatFileSize,
  formatTransferred,
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

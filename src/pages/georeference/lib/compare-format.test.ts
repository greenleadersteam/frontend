import { expect, test } from 'vitest';

import { formatCreated, formatRelative } from './compare-format';

test('разница масштаба: миллионные доли до тысячной, дальше проценты, со знаком', () => {
  expect(formatRelative(0)).toBe('0');
  expect(formatRelative(2e-6)).toBe('+2,00\u00A0млн⁻¹');
  expect(formatRelative(-2.5e-4)).toBe('−250\u00A0млн⁻¹');
  expect(formatRelative(0.5)).toBe('+50,00\u00A0%');
  expect(formatRelative(NaN)).toBe('—');
});

test('дата эталона: штамп выгрузки — с секундами, прочее — как есть', () => {
  expect(formatCreated('2026-09-23T23:35:37 UTC+03:00')).toBe('23.09.2026 в 23:35:37');
  expect(formatCreated('вчера')).toBe('вчера');
  expect(formatCreated(null)).toBe('дата неизвестна');
});

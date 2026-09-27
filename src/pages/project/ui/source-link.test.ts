import { expect, test } from 'vitest';

import { sourceUrl } from './source-link';

test.each([
  [
    'адрес в конце',
    'Высота: https://ru.wikipedia.org/wiki/Липа',
    'https://ru.wikipedia.org/wiki/%D0%9B%D0%B8%D0%BF%D0%B0',
  ],
  [
    'запятая после адреса',
    'Высота: https://x.ru/Вяз_гладкий, корни: …',
    'https://x.ru/%D0%92%D1%8F%D0%B7_%D0%B3%D0%BB%D0%B0%D0%B4%D0%BA%D0%B8%D0%B9',
  ],
  ['скобка и точка после адреса', 'Справочник (см. https://x.ru/a).', 'https://x.ru/a'],
  [
    'парная скобка в адресе остаётся',
    'См. https://x.ru/wiki/Липа_(род).',
    'https://x.ru/wiki/%D0%9B%D0%B8%D0%BF%D0%B0_(%D1%80%D0%BE%D0%B4)',
  ],
])('%s', (_, text, expected) => {
  expect(sourceUrl(text)).toBe(expected);
});

test('без адреса или не http — ссылки нет', () => {
  expect(sourceUrl('Ассортимент: 623-ПП, табл. В.6')).toBeNull();
  expect(sourceUrl(null)).toBeNull();
  expect(sourceUrl('javascript:alert(1) ftp://x.ru')).toBeNull();
});

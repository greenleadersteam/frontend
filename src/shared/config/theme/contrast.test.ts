import { DEFAULT_THEME, mergeMantineTheme } from '@mantine/core';
import { describe, expect, test } from 'vitest';

import { cssVariablesResolver, theme } from './theme';

// Относительная яркость и контраст — WCAG 2.1, определения relative luminance и contrast ratio.
function luminance(hex: string): number {
  const linear = (start: number) => {
    const c = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Проверяются значения, которые реально уходят в CSS: роли из резолвера и оттенки темы,
// которые Mantine берёт сам (заливка кнопки — primaryShade, наведение — следующий оттенок).
const merged = mergeMantineTheme(DEFAULT_THEME, theme);
const { variables } = cssVariablesResolver(merged);

const shade =
  typeof merged.primaryShade === 'number' ? merged.primaryShade : merged.primaryShade.light;
const primary = `${merged.primaryColor}.${String(shade)}` as const;
const primaryHover = `${merged.primaryColor}.${String(shade + 1)}` as const;

type ColorRef = `--${string}` | `${string}.${string}` | 'white';

function resolve(ref: ColorRef): string {
  if (ref === 'white') return merged.white;
  if (ref.startsWith('--')) {
    // startsWith не сужает шаблонный тип: ref здесь заведомо вида --имя.
    const value = variables[ref as `--${string}`];
    if (value === undefined) throw new Error(`Нет CSS-переменной ${ref}`);
    return value;
  }
  const [palette = '', shade = ''] = ref.split('.');
  const value = merged.colors[palette]?.[Number(shade)];
  if (value === undefined) throw new Error(`Нет оттенка ${ref}`);
  return value;
}

const TEXT = 4.5;
const NON_TEXT = 3;

describe('контраст ролей (design.md, «Роли»)', () => {
  test.each([
    ['основной текст на поверхности', '--app-text', '--app-surface', TEXT],
    ['основной текст на фоне страницы', '--app-text', '--app-bg', TEXT],
    ['вторичный текст на поверхности', '--app-text-muted', '--app-surface', TEXT],
    ['вторичный текст на фоне страницы', '--app-text-muted', '--app-bg', TEXT],
    ['текст stone.8 на вторичной подложке', 'stone.8', '--app-surface-muted', TEXT],
    ['граница поля, чекбокса и переключателя', '--app-border-control', '--app-surface', NON_TEXT],
    ['иконки на поверхности', '--app-icon', '--app-surface', NON_TEXT],
    ['текст на главной кнопке', 'white', primary, TEXT],
    ['текст на наведённой главной кнопке', 'white', primaryHover, TEXT],
    ['ссылка и тихая кнопка на поверхности', '--app-accent', '--app-surface', TEXT],
    ['ошибка на поверхности', '--app-error', '--app-surface', TEXT],
  ] as const)('%s', (_, foreground, background, threshold) => {
    expect(contrast(resolve(foreground), resolve(background))).toBeGreaterThanOrEqual(threshold);
  });

  test('вторичный текст на подложке stone.2 не проходит — поэтому там stone.8', () => {
    expect(contrast(resolve('--app-text-muted'), resolve('--app-surface-muted'))).toBeLessThan(
      TEXT,
    );
  });
});

describe('контраст статусов (design.md, «Статусы»)', () => {
  test.each(['draft', 'processing', 'ready', 'failed'])('%s', (status) => {
    expect(
      contrast(resolve(`--app-status-${status}-text`), resolve(`--app-status-${status}-bg`)),
    ).toBeGreaterThanOrEqual(TEXT);
  });
});

test('формула совпадает с эталоном WCAG: чёрный на белом — 21', () => {
  expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
});

import { DEFAULT_THEME, mergeMantineTheme } from '@mantine/core';
import { describe, expect, test } from 'vitest';

import { basemapColors, georeferenceColors, utilityStyles } from './map';
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

// Различие цветов — ΔE CIE76 в Lab (D65): больше 10 заметно глазом с первого взгляда.
function lab(hex: string): [number, number, number] {
  const linear = (start: number) => {
    const c = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [linear(1), linear(3), linear(5)];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

describe('сети на карте (design.md, «Карта»)', () => {
  const utilities = Object.entries(utilityStyles);

  test.each(utilities)('%s — не ниже 3:1 к земле подложки', (_, { color }) => {
    expect(contrast(color, basemapColors.earth)).toBeGreaterThanOrEqual(NON_TEXT);
  });

  test('рисунков линии не больше трёх, сети с одним рисунком различимы цветом', () => {
    expect(new Set(utilities.map(([, { dash }]) => dash)).size).toBeLessThanOrEqual(3);
    for (const [name, style] of utilities) {
      for (const [other, otherStyle] of utilities) {
        if (name >= other || style.dash !== otherStyle.dash) continue;
        const [l1, a1, b1] = lab(style.color);
        const [l2, a2, b2] = lab(otherStyle.color);
        expect(Math.hypot(l1 - l2, a1 - a2, b1 - b2), `${name} и ${other}`).toBeGreaterThan(15);
      }
    }
  });

  test('CSS-переменные легенды совпадают с цветами карты', () => {
    expect(resolve('--app-map-utility-power-cable')).toBe(utilityStyles.power_cable.color);
  });
});

test('формула совпадает с эталоном WCAG: чёрный на белом — 21', () => {
  expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
});

describe('контур геопривязки', () => {
  const { contour, contourHalo } = georeferenceColors;

  // Для любого фона max(контраст к линии, контраст к ореолу) ≥ √(контраст линии к ореолу):
  // произведение двух контрастов с фоном не меньше контраста самой пары.
  test('линия и ореол различаются так, что на любом фоне одна из них даёт не меньше 3:1', () => {
    expect(Math.sqrt(contrast(contour, contourHalo))).toBeGreaterThanOrEqual(3);
  });

  const pairs: [string, string, string][] = [
    ['опорные точки и векторы', georeferenceColors.control, georeferenceColors.controlHalo],
    ...georeferenceColors.references.map((color, index): [string, string, string] => [
      `эталон ${String(index + 1)}`,
      color,
      georeferenceColors.referenceHalo,
    ]),
  ];
  test.each(pairs)('%s — та же пара: на любом фоне не меньше 3:1', (_name, line, halo) => {
    expect(Math.sqrt(contrast(line, halo))).toBeGreaterThanOrEqual(3);
  });

  test.each([
    ['«Земля» схемы', basemapColors.earth],
    ['дороги схемы', basemapColors.roads],
    ['парки схемы', basemapColors.parks],
    ['тёмный лес на снимке', '#26301F'],
    ['асфальт на снимке', '#4A4A48'],
    ['светлый бетон на снимке', '#C9C6BF'],
  ])('%s: контур читается не хуже 4,5:1', (_name, background) => {
    const best = Math.max(contrast(contour, background), contrast(contourHalo, background));
    expect(best).toBeGreaterThanOrEqual(4.5);
  });
});

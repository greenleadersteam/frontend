import {
  Badge,
  Button,
  Card,
  Checkbox,
  createTheme,
  type CSSVariablesResolver,
  Input,
  InputWrapper,
  Paper,
  Progress,
  Stepper,
  Switch,
} from '@mantine/core';

import { basemapColors } from './map';
import { clay, ochre, sage, stone, WHITE } from './palette';
import classes from './theme.module.css';

// Варианты Badge для статусов (design.md, «Статусы»); цвета — в ролях --app-status-*.
const STATUS_VARIANTS = ['draft', 'processing', 'ready', 'failed'] as const;

export type StatusVariant = (typeof STATUS_VARIANTS)[number];

const isStatusVariant = (variant: string | undefined): variant is StatusVariant =>
  STATUS_VARIANTS.some((status) => status === variant);

export const theme = createTheme({
  // gray — палитра, которую Mantine берёт для неактивных состояний, наведения и рамок.
  // Её холодный синеватый оттенок выбивается из тёплой гаммы, поэтому она заменена на stone.
  colors: { stone, sage, clay, ochre, gray: stone },
  primaryColor: 'sage',
  primaryShade: 7,
  // Белый текст на sage.7 задан явно (контраст 5,6), подбор Mantine не нужен.
  autoContrast: false,
  white: WHITE,
  black: stone[9],
  respectReducedMotion: true,

  fontFamily: "'Mulish Variable', system-ui, sans-serif",
  fontSizes: {
    xs: '0.75rem',
    sm: '0.8125rem',
    md: '0.9375rem',
    lg: '1.0625rem',
    xl: '1.25rem',
    // Крупный экранный заголовок: только пустые состояния и стартовый экран.
    display: '2.75rem',
  },
  lineHeights: { xs: '1.55', sm: '1.55', md: '1.55', lg: '1.55', xl: '1.55' },
  headings: {
    fontFamily: "'Mulish Variable', system-ui, sans-serif",
    fontWeight: '600',
    sizes: {
      h1: { fontSize: '1.75rem', lineHeight: '1.25' },
      h2: { fontSize: '1.25rem', lineHeight: '1.3' },
      h3: { fontSize: '1.0625rem', lineHeight: '1.3' },
      h4: { fontSize: '0.9375rem', lineHeight: '1.3' },
      h5: { fontSize: '0.8125rem', lineHeight: '1.3' },
      h6: { fontSize: '0.75rem', lineHeight: '1.3' },
    },
  },

  radius: { xs: '0.375rem', sm: '0.5rem', md: '0.625rem', lg: '0.875rem', xl: '1.125rem' },
  defaultRadius: 'md',
  shadows: {
    sm: '0 1px 2px rgb(46 42 39 / 0.04), 0 10px 28px -14px rgb(46 42 39 / 0.18)',
    md: '0 2px 4px rgb(46 42 39 / 0.05), 0 18px 40px -18px rgb(46 42 39 / 0.28)',
  },
  // Шаг 4px.
  spacing: { xs: '0.25rem', sm: '0.5rem', md: '0.75rem', lg: '1rem', xl: '1.5rem' },

  components: {
    Button: Button.extend({
      classNames: { root: classes.button },
      vars: (theme, props) => ({
        root: {
          '--button-fz': theme.fontSizes.md,
          // У subtle Mantine берёт оттенок 9, по design.md нужен sage.7; явный color не трогаем.
          ...(props.variant === 'subtle' &&
            props.color === undefined && { '--button-color': 'var(--app-accent)' }),
        },
      }),
    }),
    // Размер lg даёт шрифт 13 и высоту под капсулу значения; радиус-капсула — умолчание Mantine.
    Badge: Badge.extend({
      defaultProps: { size: 'lg' },
      classNames: { root: classes.badge, section: classes.badgeValue },
      vars: (_theme, props) => ({
        root: isStatusVariant(props.variant)
          ? {
              '--badge-bg': `var(--app-status-${props.variant}-bg)`,
              '--badge-color': `var(--app-status-${props.variant}-text)`,
              '--badge-bd': 'none',
            }
          : {},
      }),
    }),
    Card: Card.extend({
      defaultProps: { radius: 'lg', shadow: 'sm', withBorder: false, padding: 'lg' },
    }),
    Paper: Paper.extend({
      defaultProps: { radius: 'lg', shadow: 'sm', withBorder: false },
    }),
    Input: Input.extend({
      classNames: { wrapper: classes.inputWrapper },
      vars: (theme) => ({ wrapper: { '--input-fz': theme.fontSizes.md } }),
    }),
    InputWrapper: InputWrapper.extend({
      classNames: {
        label: classes.inputLabel,
        description: classes.inputDescription,
        error: classes.inputError,
      },
    }),
    Checkbox: Checkbox.extend({ classNames: { input: classes.checkboxInput } }),
    Switch: Switch.extend({
      classNames: { input: classes.switchInput, track: classes.switchTrack },
    }),
    // Шаги мастера: цвет — основной (sage), подписи 13/600 без капса.
    Stepper: Stepper.extend({
      defaultProps: { size: 'sm' },
      classNames: { stepLabel: classes.stepLabel },
    }),
    Progress: Progress.extend({
      defaultProps: { size: 6, radius: 'xs' },
      classNames: { root: classes.progressTrack },
    }),
  },
});

// Роли из design.md, «Роли» и «Статусы». Компоненты проекта обращаются к ролям,
// а не к номерам оттенков: смена оттенка роли — правка в одном месте.
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    '--app-bg': stone[1],
    '--app-surface': WHITE,
    '--app-surface-muted': stone[2],
    '--app-text': stone[9],
    '--app-text-muted': stone[7],
    '--app-border-control': stone[5],
    '--app-icon': stone[6],
    '--app-accent': sage[7],
    '--app-error': clay[6],
    '--app-status-draft-bg': stone[2],
    '--app-status-draft-text': stone[8],
    '--app-status-processing-bg': ochre[1],
    '--app-status-processing-text': ochre[8],
    '--app-status-ready-bg': sage[1],
    '--app-status-ready-text': sage[8],
    '--app-status-failed-bg': clay[1],
    '--app-status-failed-text': clay[6],
    '--app-duration-fast': '150ms',
    '--app-duration': '200ms',
    '--app-content-width': '80rem',
    '--app-preview-inset': '0.625rem',
    '--app-card-lift': '0.125rem',
    '--app-card-min-width': '17.5rem',
    '--app-narrow-width': '45rem',
    '--app-map-earth': basemapColors.earth,
    '--app-map-road': basemapColors.roads,
    '--app-map-road-casing': basemapColors.roadsCasing,
  },
  // Приложение только светлое: роли Mantine по умолчанию переводятся на палитру. Фон body
  // не трогаем: его задаёт global.css, а белый --mantine-color-body нужен Card, Modal и Paper.
  light: {
    '--mantine-color-text': stone[9],
    '--mantine-color-dimmed': stone[7],
    '--mantine-color-error': clay[6],
    '--mantine-color-default-border': stone[5],
    '--mantine-color-anchor': sage[7],
    '--mantine-color-placeholder': stone[7],
  },
  dark: {},
});

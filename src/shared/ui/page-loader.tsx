import { Loader, VisuallyHidden } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import type { JSX } from 'react';

import classes from './page-loader.module.css';

// Загрузка страницы — по центру области содержимого под шапкой. Появляется через 200 мс:
// быстрые загрузки не мигают. Для экранного диктора — «Загружаем…» в живой области.
// С уменьшенным движением вместо вращения — точки, как у этапов обработки.
export function PageLoader(): JSX.Element {
  const reduceMotion = useReducedMotion();
  return (
    <div className={classes.root} role="status" aria-live="polite">
      <Loader size="md" type={reduceMotion ? 'dots' : 'oval'} aria-hidden />
      <VisuallyHidden>Загружаем…</VisuallyHidden>
    </div>
  );
}

import type { JSX } from 'react';

import type { StoredReference } from '@/entities/georeference';
import { georeferenceColors } from '@/shared/theme';

import { referenceColor } from '../lib/gcp-geometry';
import classes from './georeference-page.module.css';

// Условный знак эталона — штрих его цвета, как на карте: по нему строка списка и блок сравнения
// сопоставляются с контуром.
export function ReferenceSymbol({ reference }: { reference: StoredReference }): JSX.Element {
  return (
    <span
      aria-hidden
      className={classes.referenceSymbol}
      // Цвет — из данных: у каждого эталона свой оттенок.
      style={{ borderColor: referenceColor(reference, georeferenceColors.references) }}
    />
  );
}

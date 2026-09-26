import type { JSX } from 'react';

// Знак продукта: три кроны в оттенках шалфея. Декоративный — название стоит рядом текстом.
export function Logo(): JSX.Element {
  return (
    <svg width="28" height="24" viewBox="0 0 28 24" aria-hidden focusable="false">
      <circle cx="8" cy="14" r="7" fill="var(--mantine-color-sage-4)" />
      <circle cx="20" cy="14" r="7" fill="var(--mantine-color-sage-5)" />
      <circle cx="14" cy="9" r="8" fill="var(--mantine-color-sage-7)" />
    </svg>
  );
}

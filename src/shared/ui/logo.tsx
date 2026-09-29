import type { JSX } from 'react';

import { PRODUCT_NAME } from '@/shared/config';

import mark from './logo-mark.png';
import mark2x from './logo-mark@2x.png';

// Название продукта — alt: знак стоит в ссылке вместе с названием, которое скрыто от читалок.
export function Logo(): JSX.Element {
  return (
    <img src={mark} srcSet={`${mark} 1x, ${mark2x} 2x`} width={46} height={36} alt={PRODUCT_NAME} />
  );
}

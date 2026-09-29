import { useState } from 'react';

import type { ImageryConfig } from '@/shared/config';

import { BASEMAP_KINDS, type BasemapKind, type BasemapOption, basemapOptions } from './basemaps';

type BasemapChoice = {
  options: BasemapOption[];
  kind: BasemapKind;
  choose: (kind: BasemapKind) => void;
};

const STORAGE_KEY = 'greenleaders.basemap';

const isKind = (value: unknown): value is BasemapKind =>
  BASEMAP_KINDS.some((kind) => kind === value);

// Выбор подложки помнится до конца сеанса вкладки: это удобство, а не данные. Хранилище может
// быть недоступно (приватный режим, запрет) — тогда «Схема».
function readStored(): BasemapKind {
  try {
    // eslint-disable-next-line no-restricted-globals -- выбор подложки, не токен и не данные
    const stored = sessionStorage.getItem(STORAGE_KEY);
    return isKind(stored) ? stored : 'scheme';
  } catch {
    return 'scheme';
  }
}

function writeStored(kind: BasemapKind): void {
  try {
    // eslint-disable-next-line no-restricted-globals -- выбор подложки, не токен и не данные
    sessionStorage.setItem(STORAGE_KEY, kind);
  } catch {
    // Не запомнилось — на следующей карте будет «Схема»; эта карта уже переключилась.
  }
}

// Общий выбор подложки для всех карт продукта. Запомненный снимок без imagery в конфиге
// (контур заказчика) не показывается: тогда «Схема».
export function useBasemapChoice(imagery: ImageryConfig | null): BasemapChoice {
  const options = basemapOptions(imagery);
  const [stored, setStored] = useState(readStored);
  const kind = options.some((option) => option.kind === stored) ? stored : 'scheme';
  return {
    options,
    kind,
    choose: (next) => {
      setStored(next);
      writeStored(next);
    },
  };
}

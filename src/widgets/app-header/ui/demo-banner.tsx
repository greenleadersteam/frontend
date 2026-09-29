import { Button } from '@mantine/core';
import { type JSX, useEffect, useState } from 'react';

import { switchDataSource } from '@/shared/config';

import classes from './demo-banner.module.css';

// Режим не меняется до перезагрузки, а шапка монтируется заново при переходе между макетами
// списка и проекта: флаг на уровне модуля не даёт объявлять режим при каждом переходе.
let announcedOnce = false;

// Постоянная метка режима «Демо»: не закрывается, чтобы скриншот демо нельзя было принять за
// скриншот факта. При первом показе текст появляется после монтирования: живая область
// объявляет изменение, а не исходное содержимое, — так скринридер сообщает о режиме один раз
// за загрузку страницы.
export function DemoBanner(): JSX.Element {
  const [announced, setAnnounced] = useState(announcedOnce);
  useEffect(() => {
    announcedOnce = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- синхронизация со скринридером: текст должен появиться после вставки живой области
    setAnnounced(true);
  }, []);

  return (
    <div className={classes.root}>
      <span>
        <span role="status">{announced && 'Демонстрационные данные'}</span>
        <span className={classes.note}>
          {' '}
          Проекты и расчёты — пример. Здесь видны и функции, которые сервер пока не поддерживает.
        </span>
      </span>
      <Button
        variant="subtle"
        size="compact-sm"
        className={classes.action}
        onClick={() => void switchDataSource('server')}
      >
        Перейти к серверу
      </Button>
    </div>
  );
}

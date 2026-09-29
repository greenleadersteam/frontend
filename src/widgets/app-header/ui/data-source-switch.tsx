import { SegmentedControl, Tooltip } from '@mantine/core';
import type { JSX } from 'react';

import { currentDataSource, type DataSource, switchDataSource } from '@/shared/config';

import classes from './data-source-switch.module.css';

// Порядок: сначала факт, потом цель — жюри видит «Сервер» первым.
const OPTIONS: { value: DataSource; label: string }[] = [
  { value: 'server', label: 'Сервер' },
  { value: 'demo', label: 'Демо' },
];

const HINT =
  'Сервер — реальные проекты на сервере. Демо — демонстрационные данные в браузере: пример проектов и возможности, которые сервер пока не поддерживает. Со страницы проекта переключение откроет список проектов.';

// Режим «Демо» окрашен охрой, чтобы по любому скриншоту было видно, на каких данных он сделан.
export function DataSourceSwitch(): JSX.Element {
  const source = currentDataSource();

  return (
    <Tooltip
      label={HINT}
      withArrow
      multiline
      // Подсказка и по фокусу с клавиатуры: фокус на радиокнопке внутри всплывает к переключателю.
      events={{ hover: true, focus: true, touch: false }}
      classNames={{ tooltip: classes.hint }}
    >
      <SegmentedControl
        size="xs"
        aria-label="Источник данных"
        data={OPTIONS}
        value={source}
        onChange={(value) => void switchDataSource(value)}
        data-source={source}
        classNames={{ root: classes.root, label: classes.label }}
      />
    </Tooltip>
  );
}

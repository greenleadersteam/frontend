import { SegmentedControl, Tooltip } from '@mantine/core';
import type { JSX } from 'react';

import { currentDataSource, type DataSource, switchDataSource } from '@/shared/config';

import classes from './data-source-switch.module.css';

// Порядок: сначала факт, потом цель — жюри видит «Сервер» первым.
const OPTIONS: { value: DataSource; label: string }[] = [
  { value: 'server', label: 'Сервер' },
  { value: 'demo', label: 'Демо' },
];

const HINTS: Record<DataSource, string> = {
  demo: 'Возможности, которые ещё не реализованы на сервере, показаны на демонстрационных данных. Изменения хранятся до перезагрузки страницы',
  server: 'Данные и расчёты сервера обработки',
};

// Режим «Демо» окрашен охрой, чтобы по любому скриншоту было видно, на каких данных он сделан.
export function DataSourceSwitch(): JSX.Element {
  const source = currentDataSource();

  return (
    <Tooltip label={HINTS[source]} withArrow multiline classNames={{ tooltip: classes.hint }}>
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

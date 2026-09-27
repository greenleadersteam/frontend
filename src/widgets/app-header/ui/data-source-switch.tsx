import { SegmentedControl, Tooltip } from '@mantine/core';
import type { JSX } from 'react';

import { currentDataSource, type DataSource, switchDataSource } from '@/shared/config';

import classes from './data-source-switch.module.css';

const OPTIONS: { value: DataSource; label: string }[] = [
  { value: 'mock', label: 'Моки' },
  { value: 'server', label: 'Сервер' },
];

const HINTS: Record<DataSource, string> = {
  mock: 'Демонстрационные данные в браузере. Перезагрузка страницы сбрасывает изменения',
  server: `Данные с ${__API_PROXY_HOST__} через прокси`,
};

// Инструмент разработки: в production-сборку не попадает (см. app-header.tsx). Режим моков
// окрашен охрой, чтобы по любому скриншоту было видно, на каких данных он сделан.
export function DataSourceSwitch(): JSX.Element {
  const source = currentDataSource();

  return (
    <Tooltip label={HINTS[source]} withArrow>
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

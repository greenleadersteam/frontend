import { Select, Stack, Switch, Title, VisuallyHidden } from '@mantine/core';
import type { JSX } from 'react';

import {
  PLANT_TYPE_LABELS,
  type PlantingFeatureCollection,
  RESULT_COUNT_FORMS,
  type ResultLayerGroup,
} from '@/entities/project';
import { formatCount, formatNumber } from '@/shared/lib/format';

import classes from './layers-panel.module.css';
import { LegendSymbol } from './legend-symbol';

export type LayerVisibility = Record<ResultLayerGroup | 'basemap', boolean>;

type LayersPanelProps = {
  counts: Record<ResultLayerGroup, number>;
  visibility: LayerVisibility;
  // Без подложки (план в координатах чертежа) строки «Подложка» нет.
  showBasemap: boolean;
  basemapAvailable: boolean;
  onChange: (visibility: LayerVisibility) => void;
  planting: PlantingFeatureCollection;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  // Панель внутри Popover (узкий экран).
  inPopover: boolean;
};

// На крупном участке посадок тысячи: список показывает первые совпадения поиска.
const SEARCH_LIMIT = 50;

const ROWS: { group: ResultLayerGroup; label: string }[] = [
  { group: 'trees', label: 'Деревья' },
  { group: 'shrubs', label: 'Кустарники' },
  { group: 'zones', label: 'Зоны запрета' },
];

export function LayersPanel({
  counts,
  visibility,
  showBasemap,
  basemapAvailable,
  onChange,
  planting,
  selectedId,
  onSelect,
  inPopover,
}: LayersPanelProps): JSX.Element {
  // Искать можно только среди видимых посадок: скрытая не должна становиться выбранной.
  const options = planting.features
    .filter(({ properties }) => visibility[properties.plant_type === 'tree' ? 'trees' : 'shrubs'])
    .map(({ properties }) => ({
      value: properties.id,
      label: `${PLANT_TYPE_LABELS[properties.plant_type]} ${properties.id}`,
    }));

  return (
    <Stack gap="sm">
      <Title order={2} className={classes.title}>
        Слои
      </Title>
      {ROWS.map(({ group, label }) => (
        <Switch
          key={group}
          checked={visibility[group]}
          onChange={(event) => {
            onChange({ ...visibility, [group]: event.currentTarget.checked });
          }}
          labelPosition="left"
          classNames={{ body: classes.row, labelWrapper: classes.labelWrapper }}
          label={
            <span className={classes.label}>
              <LegendSymbol kind={group} />
              <span className={classes.name}>{label}</span>
              {/* Видно число, слышно число со словом: «24 дерева». */}
              <span className={classes.count} aria-hidden>
                {formatNumber(counts[group])}
              </span>
              <VisuallyHidden component="span">
                {`, ${formatCount(counts[group], RESULT_COUNT_FORMS[group])}`}
              </VisuallyHidden>
            </span>
          }
        />
      ))}
      {showBasemap && (
        <Switch
          checked={basemapAvailable && visibility.basemap}
          disabled={!basemapAvailable}
          onChange={(event) => {
            onChange({ ...visibility, basemap: event.currentTarget.checked });
          }}
          labelPosition="left"
          classNames={{ body: classes.row, labelWrapper: classes.labelWrapper }}
          label={
            <span className={classes.label}>
              <LegendSymbol kind="basemap" />
              <span className={classes.name}>Подложка</span>
            </span>
          }
        />
      )}
      <Select
        label="Найти посадку"
        placeholder="Номер посадки"
        data={options}
        value={selectedId}
        onChange={onSelect}
        searchable
        clearable
        // Повторный выбор той же посадки подводит к ней карту, а не снимает выбор.
        allowDeselect={false}
        limit={SEARCH_LIMIT}
        nothingFoundMessage="Посадка не найдена"
        // В Popover список в портале был бы для него «кликом снаружи» и закрывал бы поповер
        // до выбора пункта. На карте портал нужен: её контейнер обрезает список.
        comboboxProps={{ withinPortal: !inPopover }}
      />
    </Stack>
  );
}

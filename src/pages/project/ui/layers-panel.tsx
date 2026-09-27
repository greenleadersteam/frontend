import { Select, Stack, Switch, Title, VisuallyHidden } from '@mantine/core';
import type { JSX } from 'react';

import {
  PLANT_TYPE_LABELS,
  type PlantingFeatureCollection,
  RESULT_COUNT_FORMS,
  type ResultLayerGroup,
} from '@/entities/project';
import { formatCount, formatNumber, formatSquareMeters } from '@/shared/lib/format';

import classes from './layers-panel.module.css';
import { LegendSymbol } from './legend-symbol';

export type LayerVisibility = Record<ResultLayerGroup | 'basemap', boolean>;

type CountedGroup = 'trees' | 'shrubs' | 'zones';

type LayersPanelProps = {
  counts: Record<CountedGroup, number>;
  // Площадь газона, м²; null — газона в данных нет, строки нет.
  lawnArea: number | null;
  // Граница участка найдена бэкендом и есть в /zones.
  showSiteBoundary: boolean;
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

const COUNTED_ROWS: { group: CountedGroup; label: string }[] = [
  { group: 'trees', label: 'Деревья' },
  { group: 'shrubs', label: 'Кустарники' },
  { group: 'zones', label: 'Зоны запрета' },
];

export function LayersPanel({
  counts,
  lawnArea,
  showSiteBoundary,
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
      {COUNTED_ROWS.map(({ group, label }) => (
        <LayerSwitch
          key={group}
          kind={group}
          label={label}
          checked={visibility[group]}
          onToggle={(checked) => {
            onChange({ ...visibility, [group]: checked });
          }}
          // Видно число, слышно число со словом: «24 дерева».
          value={formatNumber(counts[group])}
          spoken={formatCount(counts[group], RESULT_COUNT_FORMS[group])}
        />
      ))}
      {lawnArea !== null && (
        <LayerSwitch
          kind="lawn"
          label="Газон"
          checked={visibility.lawn}
          onToggle={(checked) => {
            onChange({ ...visibility, lawn: checked });
          }}
          value={formatSquareMeters(lawnArea)}
          spoken={`площадь ${formatSquareMeters(lawnArea)}`}
        />
      )}
      {showSiteBoundary && (
        <LayerSwitch
          kind="siteBoundary"
          label="Граница участка"
          checked={visibility.siteBoundary}
          onToggle={(checked) => {
            onChange({ ...visibility, siteBoundary: checked });
          }}
        />
      )}
      {showBasemap && (
        <LayerSwitch
          kind="basemap"
          label="Подложка"
          checked={basemapAvailable && visibility.basemap}
          disabled={!basemapAvailable}
          onToggle={(checked) => {
            onChange({ ...visibility, basemap: checked });
          }}
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

type LayerSwitchProps = {
  kind: ResultLayerGroup | 'basemap';
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: (checked: boolean) => void;
  // Значение у правого края: видно коротко, скринридер слышит полную форму.
  value?: string;
  spoken?: string;
};

function LayerSwitch({
  kind,
  label,
  checked,
  disabled = false,
  onToggle,
  value,
  spoken,
}: LayerSwitchProps): JSX.Element {
  return (
    <Switch
      checked={checked}
      disabled={disabled}
      onChange={(event) => {
        onToggle(event.currentTarget.checked);
      }}
      labelPosition="left"
      classNames={{ body: classes.row, labelWrapper: classes.labelWrapper }}
      label={
        <span className={classes.label}>
          <LegendSymbol kind={kind} />
          <span className={classes.name}>{label}</span>
          {value !== undefined && (
            <span className={classes.count} aria-hidden>
              {value}
            </span>
          )}
          {spoken !== undefined && (
            <VisuallyHidden component="span">{`, ${spoken}`}</VisuallyHidden>
          )}
        </span>
      }
    />
  );
}

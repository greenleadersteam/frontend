import {
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  Title,
  VisuallyHidden,
} from '@mantine/core';
import { Fragment, type JSX } from 'react';

import {
  obstacleGroup,
  obstacleLabel,
  type ObstaclesFeatureCollection,
  PLANT_TYPE_LABELS,
  type PlantingFeatureCollection,
  type PlantType,
  RESULT_COUNT_FORMS,
  type ResultLayerGroup,
  utilityStyleOf,
} from '@/entities/project';
import { formatCount, formatNumber, formatSquareMeters } from '@/shared/lib/format';

import classes from './layers-panel.module.css';
import { LegendSymbol } from './legend-symbol';

export type LayerVisibility = Record<ResultLayerGroup | 'basemap', boolean>;

type CountedGroup = 'trees' | 'shrubs' | 'zones';

type LayersPanelProps = {
  // Число зон запрета — для выбранного типа посадки.
  counts: Record<CountedGroup, number>;
  // Для какого типа посадки показаны «можно» и зоны запрета.
  plantType: PlantType;
  onPlantTypeChange: (plantType: PlantType) => void;
  // Площадь, где посадка выбранного типа разрешена, м²; null — области в данных нет.
  allowedArea: number | null;
  // Объекты подосновы; null — сервер их не отдаёт, группы «Исходные объекты» нет.
  obstacles: ObstaclesFeatureCollection | null;
  // Число отклонённых мест; null — сервер их не отдаёт, строки нет.
  rejectedCount: number | null;
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

const PLANT_ROWS: { group: CountedGroup; label: string }[] = [
  { group: 'trees', label: 'Деревья' },
  { group: 'shrubs', label: 'Кустарники' },
];

const REJECTED_FORMS = {
  one: 'отклонённое место',
  few: 'отклонённых места',
  many: 'отклонённых мест',
};

const PLANT_TYPES = [
  { value: 'tree', label: 'Деревья' },
  { value: 'shrub', label: 'Кустарники' },
];

const OBSTACLE_ROWS = [
  { group: 'utilities', label: 'Сети' },
  { group: 'buildings', label: 'Здания' },
  { group: 'edges', label: 'Бортовой камень и тротуары' },
] as const;

export function LayersPanel({
  counts,
  plantType,
  onPlantTypeChange,
  allowedArea,
  obstacles,
  rejectedCount,
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

  // Строки группы «Исходные объекты» — только для того, что есть в данных; под «Сетями» —
  // условные знаки встреченных подтипов: сеть узнаётся не только по цвету.
  const obstacleGroups = new Set(
    obstacles?.features.map(({ properties }) => obstacleGroup(properties.category)),
  );
  const utilities = [
    ...new Set(
      obstacles?.features
        .filter(({ properties }) => obstacleGroup(properties.category) === 'utilities')
        .map(({ properties }) => utilityStyleOf(properties.subtype)),
    ),
  ];
  const toggle = (group: ResultLayerGroup) => (checked: boolean) => {
    onChange({ ...visibility, [group]: checked });
  };

  return (
    <Stack gap="sm">
      <SegmentedControl
        data={PLANT_TYPES}
        value={plantType}
        onChange={(value) => {
          onPlantTypeChange(value === 'shrub' ? 'shrub' : 'tree');
        }}
        aria-label="Где можно и где нельзя сажать: тип посадки"
        size="xs"
      />
      <Title order={2} className={classes.title}>
        Слои
      </Title>
      {PLANT_ROWS.map(({ group, label }) => (
        <LayerSwitch
          key={group}
          kind={group}
          label={label}
          checked={visibility[group]}
          onToggle={toggle(group)}
          // Видно число, слышно число со словом: «24 дерева».
          value={formatNumber(counts[group])}
          spoken={formatCount(counts[group], RESULT_COUNT_FORMS[group])}
        />
      ))}
      {allowedArea !== null && (
        <LayerSwitch
          kind="allowed"
          label="Можно сажать"
          checked={visibility.allowed}
          onToggle={toggle('allowed')}
          value={formatSquareMeters(allowedArea)}
          spoken={`площадь ${formatSquareMeters(allowedArea)}`}
        />
      )}
      <LayerSwitch
        kind="zones"
        label="Зоны запрета"
        checked={visibility.zones}
        onToggle={toggle('zones')}
        value={formatNumber(counts.zones)}
        spoken={formatCount(counts.zones, RESULT_COUNT_FORMS.zones)}
      />
      {rejectedCount !== null && (
        <LayerSwitch
          kind="rejected"
          label="Отклонённые места"
          checked={visibility.rejected}
          onToggle={toggle('rejected')}
          value={formatNumber(rejectedCount)}
          spoken={formatCount(rejectedCount, REJECTED_FORMS)}
        />
      )}
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
      {OBSTACLE_ROWS.some(({ group }) => obstacleGroups.has(group)) && (
        <>
          <Title order={3} className={classes.section}>
            Исходные объекты
          </Title>
          {OBSTACLE_ROWS.filter(({ group }) => obstacleGroups.has(group)).map(
            ({ group, label }) => (
              <Fragment key={group}>
                <LayerSwitch
                  kind={group}
                  label={label}
                  checked={visibility[group]}
                  onToggle={toggle(group)}
                />
                {group === 'utilities' && utilities.length > 0 && (
                  <ul className={classes.legend} aria-label="Условные знаки сетей">
                    {utilities.map((utility) => (
                      <li key={utility} className={classes.legendItem}>
                        <LegendSymbol kind="utility" utility={utility} />
                        <Text size="xs">{obstacleLabel('underground_utilities', utility)}</Text>
                      </li>
                    ))}
                  </ul>
                )}
              </Fragment>
            ),
          )}
        </>
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

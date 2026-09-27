import { ActionIcon, Button, Group, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCircleCheck, IconX } from '@tabler/icons-react';
import { type JSX, type Ref, useId } from 'react';

import {
  type ExplanationEntry,
  obstacleLabel,
  PLANT_TYPE_LABELS,
  type PlantingCheck,
  type PlantingFeatureCollection,
  type ZonesFeatureCollection,
} from '@/entities/project';
import { formatCoordinate, formatDrawingMeters, formatMeters } from '@/shared/lib/format';
import { Icon } from '@/shared/ui';

import classes from './planting-panel.module.css';

type PlantingPanelProps = {
  // Панель получает фокус, когда открыта из другой панели или из ведомости.
  ref: Ref<HTMLDivElement>;
  planting: PlantingFeatureCollection['features'][number]['properties'];
  entry: ExplanationEntry | undefined;
  // WGS84 — только у проекта с геопривязкой.
  coordinates: { lat: number; lon: number } | null;
  checks: PlantingCheck[];
  uncovered: ZonesFeatureCollection['metadata']['uncovered_categories'];
  usedSiteBoundary: boolean;
  // Ограничение под курсором или в фокусе: его размерная линия выделена на карте.
  onFocusCheck: (index: number | null) => void;
  // Открыть панель зоны запрета: путь к ней без щелчка по карте, в том числе с клавиатуры.
  onShowZone: (index: number) => void;
  onClose: () => void;
};

// Обоснование посадки по тому, что отдаёт бэкенд: проверки фронт выводит сам из геометрии
// зон запрета (/zones) и координат посадки, номера пунктов — только из citation.
export function PlantingPanel({
  ref,
  planting,
  entry,
  coordinates,
  checks,
  uncovered,
  usedSiteBoundary,
  onFocusCheck,
  onShowZone,
  onClose,
}: PlantingPanelProps): JSX.Element {
  const titleId = useId();
  const checksId = useId();
  const coordinateLines = [
    ...(coordinates === null
      ? []
      : [`Ш ${formatCoordinate(coordinates.lat)}, Д ${formatCoordinate(coordinates.lon)}`]),
    ...(entry === undefined
      ? []
      : [
          `В координатах чертежа: X ${formatDrawingMeters(entry.x)}, Y ${formatDrawingMeters(entry.y)}`,
        ]),
  ];

  // Clipboard API есть только в защищённом контексте и может отказать без фокуса документа.
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(coordinateLines.join('\n'));
      notifications.show({ message: 'Координаты скопированы' });
    } catch {
      notifications.show({
        color: 'clay',
        message: 'Не удалось скопировать координаты. Выделите их и скопируйте вручную.',
      });
    }
  };

  return (
    <Stack
      ref={ref}
      tabIndex={-1}
      gap="md"
      className={classes.panel}
      aria-labelledby={titleId}
      role="region"
    >
      <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
        <Stack gap={0}>
          <Title order={2} id={titleId} className={classes.title}>
            {PLANT_TYPE_LABELS[planting.plant_type]}
          </Title>
          {entry?.rule_name_ru != null && <Text>{entry.rule_name_ru}</Text>}
          <Text size="sm" c="dimmed" className={classes.numbers}>
            {planting.id}
          </Text>
        </Stack>
        <ActionIcon variant="subtle" aria-label="Закрыть" onClick={onClose}>
          <Icon icon={IconX} />
        </ActionIcon>
      </Group>

      {coordinateLines.length > 0 && (
        <Stack gap={0} align="flex-start">
          {coordinateLines.map((line) => (
            <Text key={line} size="sm" className={classes.numbers}>
              {line}
            </Text>
          ))}
          <Button variant="subtle" size="compact-sm" onClick={() => void copy()}>
            Скопировать
          </Button>
        </Stack>
      )}

      <Stack gap="xs">
        <Title order={3} id={checksId} className={classes.section}>
          Проверки
        </Title>
        {checks.length === 0 ? (
          <Text size="sm" c="dimmed">
            Рядом нет ограничений из проверенных категорий
          </Text>
        ) : (
          <ul className={classes.checks} aria-labelledby={checksId}>
            {checks.map((check, index) => (
              <CheckItem
                key={check.zone.index}
                check={check}
                onFocus={() => {
                  onFocusCheck(index);
                }}
                onBlur={() => {
                  onFocusCheck(null);
                }}
                onShowZone={() => {
                  onShowZone(check.zone.index);
                }}
              />
            ))}
          </ul>
        )}
      </Stack>

      {uncovered.length > 0 && (
        <Stack gap="xs">
          <Title order={3} className={classes.section}>
            Не проверялось
          </Title>
          <Text size="sm">
            {`Отступы не проверялись для объектов: ${uncovered
              .map(({ category, subtype }) => obstacleLabel(category, subtype).toLowerCase())
              .join(', ')}`}
          </Text>
        </Stack>
      )}
      {!usedSiteBoundary && (
        // Без границы участка бэкенд берёт весь газон (../backend/greenplan/zoning/engine.py:108-111).
        <Text size="sm">
          Граница участка в чертеже не найдена: посадки размещены по всему газону
        </Text>
      )}
    </Stack>
  );
}

type CheckItemProps = {
  check: PlantingCheck;
  onFocus: () => void;
  onBlur: () => void;
  onShowZone: () => void;
};

function CheckItem({ check, onFocus, onBlur, onShowZone }: CheckItemProps): JSX.Element {
  const { properties } = check.zone;
  const obstacle = obstacleLabel(properties.obstacle_category, properties.obstacle_subtype);
  const citation = properties.citation.trim();
  const reason = properties.reason.trim();
  const distance =
    check.kind === 'measured'
      ? `${formatMeters(check.actual, 1)} при норме не менее ${formatMeters(properties.distance_m)}`
      : check.kind === 'boundary'
        ? `до границы зоны ${formatMeters(check.margin, 1)}`
        : null;

  return (
    <li
      className={classes.check}
      // Фокус с клавиатуры выделяет размерную линию ограничения на карте, как наведение мышью.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- действия нет, только выделение на карте
      tabIndex={0}
      onMouseEnter={onFocus}
      onMouseLeave={onBlur}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {check.kind === 'inside' ? (
        <Icon icon={IconAlertTriangle} tone="error" label="Норма нарушена" />
      ) : (
        <Icon icon={IconCircleCheck} tone="accent" label="Норма выполнена" />
      )}
      <Stack gap="xs">
        <Text fw={600}>{obstacle}</Text>
        {distance === null ? (
          <Text size="sm" className={classes.warning}>
            Посадка внутри зоны запрета — сообщите разработчикам
          </Text>
        ) : (
          <Text size="sm" className={classes.numbers}>
            {distance}
          </Text>
        )}
        <Text size="sm" c="dimmed">
          {citation === '' ? 'Норма не указана сервером' : citation}
        </Text>
        {reason !== '' && reason !== citation && (
          <Text size="sm" c="dimmed">
            {reason}
          </Text>
        )}
        <Button
          variant="subtle"
          size="compact-sm"
          className={classes.showZone}
          onClick={onShowZone}
          aria-label={`Показать зону: ${obstacle}`}
        >
          Показать зону
        </Button>
      </Stack>
    </li>
  );
}

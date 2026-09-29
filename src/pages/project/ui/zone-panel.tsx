import { ActionIcon, Group, Stack, Text, Title } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { type JSX, type Ref, useId } from 'react';

import { normBasis, obstacleLabel, type ProhibitedZone, zoneArea } from '@/entities/project';
import { formatMeters, formatSquareMeters } from '@/shared/lib/format';
import { Icon } from '@/shared/ui';

import { VerifiedClauseNote } from './check-item';
import { basisReference } from './norm-reference';
import classes from './planting-panel.module.css';

type ZonePanelProps = {
  // Панель получает фокус, когда открыта из панели посадки.
  ref: Ref<HTMLDivElement>;
  zone: ProhibitedZone;
  onClose: () => void;
};

const FOR_PLANT_TYPE = { tree: 'для деревьев', shrub: 'для кустарников' } as const;

// Зона запрета — буфер препятствия на расстояние нормы (../backend/greenplan/zoning/engine.py).
export function ZonePanel({ ref, zone, onClose }: ZonePanelProps): JSX.Element {
  const titleId = useId();
  const { properties } = zone;
  const citation = properties.citation.trim();
  const reason = properties.reason.trim();
  const reference = basisReference(
    normBasis(
      null,
      properties.obstacle_category,
      properties.obstacle_subtype,
      properties.plant_type,
      properties.distance_m,
    ),
    null,
    citation,
  );

  return (
    <Stack
      ref={ref}
      tabIndex={-1}
      gap="sm"
      className={classes.panel}
      aria-labelledby={titleId}
      role="region"
    >
      <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
        <Stack gap={0}>
          <Text size="sm" c="dimmed">
            Зона запрета
          </Text>
          <Title order={2} id={titleId} className={classes.title}>
            {obstacleLabel(properties.obstacle_category, properties.obstacle_subtype)}
          </Title>
        </Stack>
        <ActionIcon variant="subtle" aria-label="Закрыть" onClick={onClose}>
          <Icon icon={IconX} />
        </ActionIcon>
      </Group>
      <Text className={classes.numbers}>
        {`Отступ ${FOR_PLANT_TYPE[properties.plant_type]} не менее ${formatMeters(properties.distance_m)}`}
      </Text>
      <Text size="sm" c="dimmed">
        {reference.text}
      </Text>
      {reference.verified && <VerifiedClauseNote />}
      {reason !== '' && reason !== citation && (
        <Text size="sm" c="dimmed">
          {reason}
        </Text>
      )}
      <Text size="sm" className={classes.numbers}>
        {`Площадь по данным карты: ${formatSquareMeters(zoneArea(zone))}`}
      </Text>
    </Stack>
  );
}

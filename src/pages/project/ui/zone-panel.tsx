import { ActionIcon, Group, Stack, Text, Title } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { type JSX, type Ref, useId } from 'react';

import {
  type Norm,
  normBasis,
  obstacleLabel,
  type ProhibitedZone,
  zoneArea,
} from '@/entities/project';
import { formatMeters, formatSquareMeters } from '@/shared/lib/format';
import { Icon } from '@/shared/ui';

import { VerifiedClauseNote } from './check-item';
import { basisReference } from './norm-reference';
import classes from './planting-panel.module.css';
import { SourceLink, sourceUrl } from './source-link';

type ZonePanelProps = {
  // Панель получает фокус, когда открыта из панели посадки.
  ref: Ref<HTMLDivElement>;
  zone: ProhibitedZone;
  // Норма /norms для типа посадки и объекта зоны — та же, что у проверок карточки посадки;
  // null — сервер норм не отдаёт.
  norm: Norm | null;
  onClose: () => void;
};

const FOR_PLANT_TYPE = { tree: 'для деревьев', shrub: 'для кустарников' } as const;

// Зона запрета — буфер препятствия на расстояние нормы (../backend/greenplan/zoning/engine.py).
export function ZonePanel({ ref, zone, norm, onClose }: ZonePanelProps): JSX.Element {
  const titleId = useId();
  const { properties } = zone;
  const citation = properties.citation.trim();
  const basis = normBasis(
    norm,
    properties.obstacle_category,
    properties.obstacle_subtype,
    properties.plant_type,
    properties.distance_m,
  );
  const reference = basisReference(basis, norm, citation);
  const source = sourceUrl(norm?.source_url ?? null);
  const label = obstacleLabel(properties.obstacle_category, properties.obstacle_subtype);

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
            {label}
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
      {/* reason сервера — машинная строка («< 6.0 м от объекта типа «existing_tree»»): объект уже
          в заголовке, отступ — строкой выше. Текст нормы и источник — из /norms. */}
      {basis?.basis === 'regulation' && norm !== null && norm.text !== '' && (
        <Text size="sm" c="dimmed">
          {norm.text}
        </Text>
      )}
      {source !== null && <SourceLink href={source} label={`Источник нормы: ${label}`} />}
      <Text size="sm" className={classes.numbers}>
        {`Площадь по данным карты: ${formatSquareMeters(zoneArea(zone))}`}
      </Text>
    </Stack>
  );
}

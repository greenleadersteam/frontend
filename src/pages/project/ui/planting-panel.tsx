import { ActionIcon, Group, Stack, Text, Title } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { type JSX, useId } from 'react';

import {
  CROWN_RADIUS_M,
  PLANT_TYPE_LABELS,
  type PlantingFeatureCollection,
  useGetProcessingDefaultsQuery,
} from '@/entities/project';
import { formatMeters } from '@/shared/lib/format';
import { Icon } from '@/shared/ui';

import classes from './planting-panel.module.css';

type PlantingPanelProps = {
  planting: PlantingFeatureCollection['features'][number]['properties'];
  onClose: () => void;
};

// Обоснование по нормам появится здесь в проходе с объяснением посадок.
export function PlantingPanel({ planting, onClose }: PlantingPanelProps): JSX.Element {
  // Название правила по-русски есть только в параметрах обработки (контракт-предложение):
  // в /planting приходит один rule_id. Пока параметров нет, строка правила не показывается.
  const { data: defaults } = useGetProcessingDefaultsQuery(undefined);
  const ruleName = defaults?.planting_rules[planting.rule_id]?.name_ru;
  const titleId = useId();

  return (
    <Stack gap="xs" className={classes.panel} aria-labelledby={titleId} role="region">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Title order={2} id={titleId} className={classes.title}>
          Посадка
        </Title>
        <ActionIcon variant="subtle" aria-label="Закрыть" onClick={onClose}>
          <Icon icon={IconX} />
        </ActionIcon>
      </Group>
      <Text fw={600}>{PLANT_TYPE_LABELS[planting.plant_type]}</Text>
      {ruleName !== undefined && <Text>{ruleName}</Text>}
      <Text size="sm">{`Радиус кроны ${formatMeters(CROWN_RADIUS_M[planting.plant_type])}`}</Text>
      <Text size="sm" c="dimmed" className={classes.id}>
        {planting.id}
      </Text>
    </Stack>
  );
}

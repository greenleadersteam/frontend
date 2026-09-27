import { ActionIcon, Group, Stack, Text, Title } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { type JSX, type Ref, useId } from 'react';

import {
  obstacleLabel,
  type PlantType,
  type PreparedObstacle,
  type PreparedObstacles,
} from '@/entities/project';
import { formatMeters } from '@/shared/lib/format';
import { Icon } from '@/shared/ui';

import { normReference } from './norm-reference';
import classes from './planting-panel.module.css';

type ObstaclePanelProps = {
  // Панель получает фокус, когда открыта из панели посадки.
  ref: Ref<HTMLDivElement>;
  obstacle: PreparedObstacle;
  norms: Pick<PreparedObstacles, 'norm' | 'catalog'>;
  onClose: () => void;
};

const NORM_ROWS: { plantType: PlantType; label: string }[] = [
  { plantType: 'tree', label: 'Для деревьев' },
  { plantType: 'shrub', label: 'Для кустарников' },
];

// Исходный объект подосновы: откуда он взят (слой и handle DXF — эксперт найдёт его в чертеже)
// и какие нормы отступа от него действуют. Слой и handle — недоверенные данные, только текст.
export function ObstaclePanel({ ref, obstacle, norms, onClose }: ObstaclePanelProps): JSX.Element {
  const titleId = useId();
  const normsId = useId();
  const { category, subtype, layer, handle } = obstacle.properties;
  const categoryLabel = obstacleLabel(category, null);
  const title = obstacleLabel(category, subtype);
  // Без /norms нормы — только из зон запрета: у типа без зоны строка остаётся с пояснением,
  // а не пропадает молча.
  const rows = NORM_ROWS.flatMap(({ plantType, label }) => {
    const setback = norms.norm(plantType, category, subtype);
    return setback === undefined && norms.catalog ? [] : [{ plantType, label, setback }];
  });

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
          <Text size="sm" c="dimmed">
            {title === categoryLabel ? 'Исходный объект' : categoryLabel}
          </Text>
          <Title order={2} id={titleId} className={classes.title}>
            {title}
          </Title>
        </Stack>
        <ActionIcon variant="subtle" aria-label="Закрыть" onClick={onClose}>
          <Icon icon={IconX} />
        </ActionIcon>
      </Group>

      <Stack gap={0}>
        <Text size="sm" c="dimmed">{`Слой DXF: ${layer}`}</Text>
        <Text size="sm" c="dimmed" className={classes.numbers}>
          {handle === null ? 'Handle нет: объект из внешней ссылки или блока' : `Handle: ${handle}`}
        </Text>
      </Stack>

      <Stack gap="xs">
        <Title order={3} id={normsId} className={classes.section}>
          Нормы отступа
        </Title>
        {rows.length === 0 ? (
          // Без /norms строки есть всегда: пусто — только когда справочник нормы не знает.
          <Text size="sm">Нормы отступа от таких объектов в сервисе нет</Text>
        ) : (
          <ul className={classes.checks} aria-labelledby={normsId}>
            {rows.map(({ plantType, label, setback }) => (
              <li key={plantType}>
                {setback === undefined ? (
                  <Text>{`${label} — норма в данных результата не указана`}</Text>
                ) : (
                  <Stack gap="xs">
                    <Text className={classes.numbers}>
                      {`${label} — не ближе ${formatMeters(setback.required)}`}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {normReference(setback.norm, setback.citation)}
                    </Text>
                    {setback.norm !== null && (
                      <Text size="sm" c="dimmed">
                        {setback.norm.text}
                      </Text>
                    )}
                  </Stack>
                )}
              </li>
            ))}
          </ul>
        )}
      </Stack>
    </Stack>
  );
}

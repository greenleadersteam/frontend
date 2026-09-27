import { ActionIcon, Group, Stack, Text, Title } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { type JSX, type Ref, useId } from 'react';

import type {
  PlantingCheck,
  PlantType,
  PreparedObstacle,
  RejectedSitesFeatureCollection,
} from '@/entities/project';
import { Icon } from '@/shared/ui';

import { CheckItem } from './check-item';
import classes from './planting-panel.module.css';

const TITLES = {
  tree: 'Здесь сервис не стал сажать дерево',
  shrub: 'Здесь сервис не стал сажать кустарник',
} satisfies Record<PlantType, string>;

type RejectedPanelProps = {
  ref: Ref<HTMLDivElement>;
  site: RejectedSitesFeatureCollection['features'][number]['properties'];
  // Русское имя правила из /explanation; null — посадок этого правила нет, имени не знаем.
  ruleName: string | null;
  // Непройденные проверки: числа сервера, точка на объекте — для размерной линии.
  checks: Extract<PlantingCheck, { kind: 'object' }>[];
  onFocusCheck: (index: number | null) => void;
  onShowObstacle: (obstacle: PreparedObstacle) => void;
  onClose: () => void;
};

// Отклонённое место (/rejected): правило рассматривало точку, но норма не позволила.
export function RejectedPanel({
  ref,
  site,
  ruleName,
  checks,
  onFocusCheck,
  onShowObstacle,
  onClose,
}: RejectedPanelProps): JSX.Element {
  const titleId = useId();
  const checksId = useId();

  return (
    <Stack
      ref={ref}
      tabIndex={-1}
      gap="md"
      className={classes.panel}
      aria-labelledby={titleId}
      role="region"
    >
      <Group
        justify="space-between"
        wrap="nowrap"
        gap="sm"
        align="flex-start"
        className={classes.header}
      >
        <Stack gap={0}>
          <Text size="sm" c="dimmed">
            Отклонённое место
          </Text>
          <Title order={2} id={titleId} className={classes.title}>
            {TITLES[site.plant_type]}
          </Title>
        </Stack>
        <ActionIcon variant="subtle" aria-label="Закрыть" onClick={onClose}>
          <Icon icon={IconX} />
        </ActionIcon>
      </Group>
      {ruleName !== null && <Text>{ruleName}</Text>}

      <Stack gap="xs">
        <Title order={3} id={checksId} className={classes.section}>
          Непройденные проверки
        </Title>
        <ul className={classes.checks} aria-labelledby={checksId}>
          {checks.map((check, index) => (
            <CheckItem
              // По проверке на подтип: у отклонённого места проверки только по объектам.
              key={`${check.category}|${String(check.subtype)}`}
              check={check}
              onFocus={() => {
                onFocusCheck(index);
              }}
              onBlur={() => {
                onFocusCheck(null);
              }}
              onShowObstacle={onShowObstacle}
            />
          ))}
        </ul>
      </Stack>
    </Stack>
  );
}

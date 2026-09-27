import { ActionIcon, Group, Stack, Text, Title } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { type JSX, type Ref, useId } from 'react';

import { type LawnSummary, RESULT_COUNT_FORMS } from '@/entities/project';
import { formatCount, formatPercent, formatSquareMeters } from '@/shared/lib/format';
import { Icon } from '@/shared/ui';

import classes from './planting-panel.module.css';

type LawnPanelProps = {
  ref: Ref<HTMLDivElement>;
  summary: LawnSummary;
  onClose: () => void;
};

// Газон (lawn_raw из /zones): всё считается на фронте по имеющимся данным.
export function LawnPanel({ ref, summary, onClose }: LawnPanelProps): JSX.Element {
  const titleId = useId();

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
        <Title order={2} id={titleId} className={classes.title}>
          Газон
        </Title>
        <ActionIcon variant="subtle" aria-label="Закрыть" onClick={onClose}>
          <Icon icon={IconX} />
        </ActionIcon>
      </Group>
      <Stack gap="xs" className={classes.numbers}>
        <Text>{`Площадь ${formatSquareMeters(summary.area)}`}</Text>
        {summary.siteArea !== null && Math.round(summary.siteArea) !== Math.round(summary.area) && (
          <Text size="sm">{`В границах участка ${formatSquareMeters(summary.siteArea)}`}</Text>
        )}
        <Text size="sm">
          {`На газоне ${formatCount(summary.trees, RESULT_COUNT_FORMS.trees)} и ${formatCount(summary.shrubs, RESULT_COUNT_FORMS.shrubs)}`}
        </Text>
      </Stack>
      <Stack gap="xs">
        <Title order={3} className={classes.section}>
          {summary.siteArea === null
            ? 'Под зонами запрета'
            : 'Под зонами запрета в границах участка'}
        </Title>
        <Text size="sm" className={classes.numbers}>
          {`Для деревьев — ${formatPercent(summary.prohibitedShare.tree)} площади`}
        </Text>
        <Text size="sm" className={classes.numbers}>
          {`Для кустарников — ${formatPercent(summary.prohibitedShare.shrub)} площади`}
        </Text>
      </Stack>
    </Stack>
  );
}

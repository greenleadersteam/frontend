import { Stack, Text, Title } from '@mantine/core';
import type { JSX, ReactNode } from 'react';

import classes from './empty-state.module.css';

type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

// Единственное место, где разрешён крупный заголовок капсом (design.md, «Типографика»).
export function EmptyState({ title, description, action }: EmptyStateProps): JSX.Element {
  return (
    <Stack gap="lg" align="flex-start" className={classes.root}>
      <Title order={2} className={classes.title}>
        {title}
      </Title>
      <Text c="dimmed">{description}</Text>
      {action}
    </Stack>
  );
}

import { Button, Group, Stack, Text, Title } from '@mantine/core';
import type { JSX } from 'react';
import { Link } from 'react-router';

import {
  currentDataSource,
  getRuntimeConfig,
  paths,
  PRODUCT_NAME,
  switchDataSource,
} from '@/shared/config';
import { NotFoundScreen } from '@/shared/ui';

// Проекта нет в текущем режиме. Частый случай — адрес из другого режима: демо-проекта нет на
// сервере и наоборот. Вместо общей 404 — что случилось и куда идти.
export function ProjectNotFound(): JSX.Element {
  if (getRuntimeConfig().demoMode !== 'available') return <NotFoundScreen />;
  const demo = currentDataSource() === 'demo';
  const other = demo ? 'server' : 'demo';
  return (
    <Stack gap="md" align="flex-start">
      <title>{`Проект не найден — ${PRODUCT_NAME}`}</title>
      <Title order={1}>Проект не найден</Title>
      <Text>
        {demo
          ? 'В режиме «Демо» такого проекта нет — это проект сервера.'
          : 'На сервере такого проекта нет — возможно, это демо-проект.'}
      </Text>
      <Group>
        <Button onClick={() => void switchDataSource(other, undefined, true)}>
          {demo ? 'Открыть в режиме «Сервер»' : 'Открыть в режиме «Демо»'}
        </Button>
        <Button component={Link} to={paths.projects} variant="default">
          {demo ? 'К демо-проектам' : 'К проектам сервера'}
        </Button>
      </Group>
    </Stack>
  );
}

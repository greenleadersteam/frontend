import { Title } from '@mantine/core';
import type { JSX } from 'react';

import { PRODUCT_NAME } from '@/shared/config';

export function ProjectsPage(): JSX.Element {
  return (
    <>
      <title>{`Проекты — ${PRODUCT_NAME}`}</title>
      <Title order={1}>Проекты</Title>
    </>
  );
}

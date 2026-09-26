import { Title } from '@mantine/core';
import type { JSX } from 'react';
import { useParams } from 'react-router';

import { isProjectId } from '@/entities/project';
import { PRODUCT_NAME } from '@/shared/config';
import { NotFoundScreen } from '@/shared/ui';

export function ProjectPage(): JSX.Element {
  const { projectId } = useParams();
  if (!isProjectId(projectId)) {
    return <NotFoundScreen />;
  }

  return (
    <>
      <title>{`Проект — ${PRODUCT_NAME}`}</title>
      <Title order={1}>Проект</Title>
    </>
  );
}

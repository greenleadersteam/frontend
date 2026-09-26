import { Title } from '@mantine/core';
import type { JSX } from 'react';
import { useParams } from 'react-router';

import { PRODUCT_NAME } from '@/shared/config';
import { NotFoundScreen } from '@/shared/ui';

// Формат id бэкенд не документирует; реальные id — 32 hex-символа, правило взято с запасом.
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function ProjectPage(): JSX.Element {
  const { projectId } = useParams();
  if (projectId === undefined || !PROJECT_ID_PATTERN.test(projectId)) {
    return <NotFoundScreen />;
  }

  return (
    <>
      <title>{`Проект — ${PRODUCT_NAME}`}</title>
      <Title order={1}>Проект</Title>
    </>
  );
}

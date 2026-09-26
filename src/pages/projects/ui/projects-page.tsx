import type { JSX } from 'react';

import { PRODUCT_NAME } from '@/shared/config';

import { ProjectList } from './project-list';

export function ProjectsPage(): JSX.Element {
  return (
    <>
      <title>{`Проекты — ${PRODUCT_NAME}`}</title>
      <ProjectList />
    </>
  );
}

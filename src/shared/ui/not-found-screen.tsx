import { Anchor, Title } from '@mantine/core';
import type { JSX } from 'react';
import { Link } from 'react-router';

import { paths, PRODUCT_NAME } from '@/shared/config';

export function NotFoundScreen(): JSX.Element {
  return (
    <>
      <title>{`Страница не найдена — ${PRODUCT_NAME}`}</title>
      <Title order={1}>Страница не найдена</Title>
      <Anchor component={Link} to={paths.projects}>
        К списку проектов
      </Anchor>
    </>
  );
}

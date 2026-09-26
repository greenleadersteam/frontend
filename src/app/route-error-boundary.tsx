import { Button, Code, Text, Title } from '@mantine/core';
import type { JSX } from 'react';
import { useRouteError } from 'react-router';

import { PRODUCT_NAME } from '@/shared/config';

const describeError = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

export function RouteErrorBoundary(): JSX.Element {
  const error = useRouteError();

  return (
    <>
      <title>{`Ошибка — ${PRODUCT_NAME}`}</title>
      <Title order={1}>Что-то пошло не так</Title>
      <Text>Обновите страницу. Если ошибка повторяется, сообщите администратору.</Text>
      <Button
        onClick={() => {
          location.reload();
        }}
      >
        Обновить страницу
      </Button>
      {import.meta.env.DEV && <Code block>{describeError(error)}</Code>}
    </>
  );
}

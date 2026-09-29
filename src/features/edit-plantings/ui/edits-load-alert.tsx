import { Alert, Button, Stack, Text } from '@mantine/core';
import type { JSX } from 'react';

import { describeAppError, toAppError } from '@/shared/api';

import { usePlantingVersions } from '../model/use-planting-edits';

type EditsLoadAlertProps = { projectId: string };

// Версии плана посадок не загрузились: без версии режим правки закрыт — править было бы
// нечего и не от чего сохранять.
export function EditsLoadAlert({ projectId }: EditsLoadAlertProps): JSX.Element | null {
  const { error, fetching, retry } = usePlantingVersions(projectId);
  if (error === undefined) return null;

  return (
    <Alert color="clay" variant="light">
      <Stack gap="sm" align="flex-start">
        <Text size="sm">
          Не удалось загрузить версии плана посадок. Повторите загрузку: до этого править нельзя.
        </Text>
        <Text size="xs" c="dimmed">
          {describeAppError(toAppError(error))}
        </Text>
        <Button size="compact-md" variant="default" loading={fetching} onClick={retry}>
          Повторить
        </Button>
      </Stack>
    </Alert>
  );
}

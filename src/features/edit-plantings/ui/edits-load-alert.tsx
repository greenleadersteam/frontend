import { Alert, Button, Stack, Text } from '@mantine/core';
import type { JSX } from 'react';

import { useGetPlantingsQuery } from '@/entities/project';
import { describeAppError, toAppError } from '@/shared/api';
import { useCapability } from '@/shared/config';

type EditsLoadAlertProps = { projectId: string };

// Правки с сервера не загрузились: без них режим правки закрыт, иначе сохранение поверх пустой
// разницы стёрло бы правки на сервере.
export function EditsLoadAlert({ projectId }: EditsLoadAlertProps): JSX.Element | null {
  const withServer = useCapability('plantingEdits');
  const { error, isError, isFetching, refetch } = useGetPlantingsQuery(projectId, {
    skip: !withServer,
  });
  if (!isError) return null;

  return (
    <Alert color="clay" variant="light">
      <Stack gap="sm" align="flex-start">
        <Text size="sm">
          Не удалось загрузить правки расстановки. Повторите загрузку: до этого править нельзя.
        </Text>
        <Text size="xs" c="dimmed">
          {describeAppError(toAppError(error))}
        </Text>
        <Button
          size="compact-md"
          variant="default"
          loading={isFetching}
          onClick={() => void refetch()}
        >
          Повторить
        </Button>
      </Stack>
    </Alert>
  );
}

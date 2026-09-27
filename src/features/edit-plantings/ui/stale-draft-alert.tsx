import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import type { JSX } from 'react';

import { useAppSelector } from '@/shared/lib/store';

import { selectProjectEdits } from '../model/edits';
import { useStaleDraft } from '../model/use-planting-edits';

type StaleDraftAlertProps = { projectId: string };

// Черновик правок остался от прошлой обработки проекта: его координаты относятся к другой
// расстановке. Пока пользователь не решил, правок нет; «Оставить как есть» — только просмотр.
export function StaleDraftAlert({ projectId }: StaleDraftAlertProps): JSX.Element | null {
  const entry = useAppSelector((state) => selectProjectEdits(state, projectId));
  const { discard, keep } = useStaleDraft(projectId);
  if (entry === undefined) return null;

  if (entry.stale !== null) {
    return (
      <Alert color="ochre" variant="light">
        <Stack gap="sm">
          <Text size="sm">
            Правки относятся к прошлой обработке. Проект обработан заново, и расстановка могла
            измениться.
          </Text>
          <Group gap="sm">
            <Button size="compact-md" color="clay" onClick={discard}>
              Удалить правки
            </Button>
            <Button size="compact-md" variant="default" onClick={keep}>
              Оставить как есть
            </Button>
          </Group>
        </Stack>
      </Alert>
    );
  }
  if (entry.readOnly) {
    return (
      <Group justify="space-between" gap="sm">
        <Text size="sm" c="dimmed">
          Правки прошлой обработки — только просмотр: править их нельзя.
        </Text>
        <Button size="compact-sm" variant="subtle" onClick={discard}>
          Удалить правки
        </Button>
      </Group>
    );
  }
  return null;
}

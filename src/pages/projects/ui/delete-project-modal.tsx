import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { type JSX, useState } from 'react';

import { type Project, useDeleteProjectMutation } from '@/entities/project';
import { describeAppError, toAppError } from '@/shared/api';

import classes from './delete-project-modal.module.css';

// Порог зависшей обработки: столько же длится предохранитель опроса (api.md).
export const PROCESSING_HANG_MINUTES = 30;

type DeleteProjectModalProps = {
  project: Pick<Project, 'id' | 'name'>;
  opened: boolean;
  onClose: () => void;
  onDeleted: () => void;
  // Проект с зависшей обработкой: где он застрял. Про прерывание обработки ничего не
  // обещаем — бэкенд при DELETE её не останавливает (../backend/greenplan/api/storage.py:133).
  hang: 'queued' | 'processing' | null;
};

export function DeleteProjectModal({
  project,
  opened,
  onClose,
  onDeleted,
  hang,
}: DeleteProjectModalProps): JSX.Element {
  const [deleteProject, { isLoading, error, reset }] = useDeleteProjectMutation();
  // Кнопка меню, на которую окно вернуло бы фокус, исчезает вместе с карточкой.
  const [deleted, setDeleted] = useState(false);

  const close = () => {
    reset();
    onClose();
  };

  // При ошибке окно остаётся открытым: пользователь видит причину и может повторить.
  const confirm = async () => {
    const result = await deleteProject(project.id);
    if ('error' in result) return;
    notifications.show({ message: 'Проект удалён' });
    setDeleted(true);
    close();
    onDeleted();
  };

  return (
    <Modal
      opened={opened}
      onClose={close}
      title="Удалить проект?"
      // Пока запрос идёт, окно закрывается только его результатом.
      closeOnEscape={!isLoading}
      closeOnClickOutside={!isLoading}
      withCloseButton={!isLoading}
      returnFocus={!deleted}
      // Если карточка после удаления осталась (например, список не обновился), следующее
      // закрытие окна снова возвращает фокус на кнопку меню.
      onExitTransitionEnd={() => {
        setDeleted(false);
      }}
    >
      <Stack gap="lg">
        <Stack gap="xs">
          <Text>{`Проект «${project.name}» и результаты обработки будут удалены. Это действие нельзя отменить.`}</Text>
          {hang !== null && (
            <Text>
              {hang === 'queued'
                ? `Проект ждёт в очереди больше ${String(PROCESSING_HANG_MINUTES)} минут.`
                : `Обработка идёт больше ${String(PROCESSING_HANG_MINUTES)} минут.`}
            </Text>
          )}
          {error !== undefined && (
            <Text size="sm" className={classes.error}>
              {describeAppError(toAppError(error))}
            </Text>
          )}
        </Stack>
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={close} disabled={isLoading}>
            Отмена
          </Button>
          <Button color="clay" loading={isLoading} onClick={() => void confirm()}>
            Удалить
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

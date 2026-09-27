import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { type JSX, useState } from 'react';

import { useEditMode } from '../model/use-edit-mode';

type EditModeButtonProps = { projectId: string };

// «Править расстановку» в шапке экрана проекта; в режиме правки — «Готово». Несохранённые
// на сервере правки при выходе остаются, но выход спрашивает подтверждение.
export function EditModeButton({ projectId }: EditModeButtonProps): JSX.Element | null {
  const mode = useEditMode(projectId);
  const [confirming, setConfirming] = useState(false);
  if (!mode.available) return null;

  return (
    <>
      <Button
        variant="default"
        onClick={() => {
          if (mode.editing && mode.unsaved) {
            setConfirming(true);
            return;
          }
          mode.setEditing(!mode.editing);
        }}
      >
        {mode.editing ? 'Готово' : 'Править расстановку'}
      </Button>
      <Modal
        opened={confirming}
        onClose={() => {
          setConfirming(false);
        }}
        title="Правки не сохранены"
      >
        <Stack gap="lg">
          <Text>
            Правки останутся в этом окне, но на сервере их нет. Сохраните их или выйдите из режима
            правки без сохранения.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Остаться
            </Button>
            <Button
              color="clay"
              onClick={() => {
                setConfirming(false);
                mode.setEditing(false);
              }}
            >
              Выйти без сохранения
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

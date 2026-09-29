import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { type JSX, useState } from 'react';

import { useEditMode } from '../model/use-edit-mode';
import { usePlantingVersions } from '../model/use-planting-edits';

type EditModeButtonProps = { projectId: string };

// «Править расстановку» в шапке экрана проекта; в режиме правки — «Готово». Несохранённые
// на сервере правки при выходе остаются, но выход спрашивает подтверждение.
export function EditModeButton({ projectId }: EditModeButtonProps): JSX.Element | null {
  const mode = useEditMode(projectId);
  const { error } = usePlantingVersions(projectId);
  const [confirming, setConfirming] = useState(false);
  // Пока правки грузятся, кнопка на своём месте, но недоступна: не появляется из ниоткуда.
  // Не загрузились — её нет, а плашка предлагает повторить.
  if (mode.loading && error === undefined) {
    return (
      <Button variant="default" loading>
        Править расстановку
      </Button>
    );
  }
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

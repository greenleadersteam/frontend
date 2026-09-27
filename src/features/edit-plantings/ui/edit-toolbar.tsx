import {
  ActionIcon,
  Button,
  Divider,
  Group,
  Modal,
  Stack,
  Text,
  Tooltip,
  VisuallyHidden,
} from '@mantine/core';
import { useWindowEvent } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconPlant2,
  IconRestore,
  IconTrash,
  IconTree,
} from '@tabler/icons-react';
import { type JSX, type ReactNode, useId, useState } from 'react';

import type { PlantingFeatureCollection } from '@/entities/project';
import { describeAppError } from '@/shared/api';
import { formatNumber } from '@/shared/lib/format';
import { isTyping } from '@/shared/lib/keyboard';
import { useAppDispatch } from '@/shared/lib/store';
import { Icon } from '@/shared/ui';

import { plantingEditsActions as actions } from '../model/edits';
import { useEditMode } from '../model/use-edit-mode';
import { usePlantingEdits, useSavePlantings } from '../model/use-planting-edits';
import classes from './edit-toolbar.module.css';

type EditToolbarProps = {
  projectId: string;
  source: PlantingFeatureCollection;
  // Выбранная посадка: её удаляет кнопка «Удалить выбранную».
  selectedId: string | null;
  // План на экране: при скрытом плане Ctrl+Z и Ctrl+Y не меняют невидимое.
  active: boolean;
  onRemoved: () => void;
};

const PLACE_HINT = 'Щелчок по карте или Enter на карте ставит посадку';

type ToolProps = {
  label: string;
  icon: typeof IconTree;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  // Как выполнить действие, если одной кнопки мало: видно в подсказке, слышно в описании.
  hint?: string;
};

function Tool({ label, icon, onClick, disabled = false, pressed, hint }: ToolProps): JSX.Element {
  const hintId = useId();
  return (
    <Tooltip label={hint === undefined ? label : `${label}. ${hint}`}>
      <ActionIcon
        aria-describedby={hint === undefined ? undefined : hintId}
        variant={pressed === true ? 'light' : 'subtle'}
        size="lg"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
      >
        <Icon icon={icon} />
        {hint !== undefined && <VisuallyHidden id={hintId}>{hint}</VisuallyHidden>}
      </ActionIcon>
    </Tooltip>
  );
}

// Панель правки поверх карты: добавить, удалить, отменить, повторить, сбросить, сохранить.
export function EditToolbar({
  projectId,
  source,
  selectedId,
  active,
  onRemoved,
}: EditToolbarProps): JSX.Element {
  const dispatch = useAppDispatch();
  const mode = useEditMode(projectId);
  const edits = usePlantingEdits(projectId, source);
  const { save, saving } = useSavePlantings(projectId, source);
  const [resetting, setResetting] = useState(false);

  const undo = () => dispatch(actions.undone({ projectId }));
  const redo = () => dispatch(actions.redone({ projectId }));
  const toggleTool = (tool: 'tree' | 'shrub') => {
    mode.setTool(mode.tool === tool ? 'select' : tool);
  };
  const remove = () => {
    if (selectedId === null) return;
    dispatch(actions.removed({ projectId, id: selectedId }));
    onRemoved();
  };

  useWindowEvent('keydown', (event) => {
    if (!active || isTyping(event.target) || !(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undo();
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      redo();
    }
  });

  let storage: ReactNode;
  switch (edits.storage) {
    case 'server':
      storage = (
        <Button
          size="compact-md"
          loading={saving}
          disabled={!edits.unsaved}
          onClick={() => {
            void save().then((error) => {
              if (error !== null) {
                notifications.show({ color: 'clay', message: describeAppError(error) });
              }
            });
          }}
        >
          Сохранить
        </Button>
      );
      break;
    case 'draft':
      storage = (
        <Text size="sm" c="dimmed">
          Черновик в этом браузере
        </Text>
      );
      break;
    case 'memory':
      storage = (
        <Text size="sm" c="dimmed">
          Браузер не хранит черновик: правки — до перезагрузки
        </Text>
      );
      break;
    default: {
      const unexpected: never = edits.storage;
      storage = unexpected;
    }
  }

  return (
    <Group
      gap="xs"
      wrap="nowrap"
      className={classes.toolbar}
      role="group"
      aria-label="Правка расстановки"
    >
      <Tool
        label="Добавить дерево"
        hint={PLACE_HINT}
        icon={IconTree}
        pressed={mode.tool === 'tree'}
        onClick={() => {
          toggleTool('tree');
        }}
      />
      <Tool
        label="Добавить кустарник"
        hint={PLACE_HINT}
        icon={IconPlant2}
        pressed={mode.tool === 'shrub'}
        onClick={() => {
          toggleTool('shrub');
        }}
      />
      <Tool
        label="Удалить выбранную"
        icon={IconTrash}
        disabled={selectedId === null}
        onClick={remove}
      />
      <Divider orientation="vertical" />
      <Tool
        label="Отменить (Ctrl+Z)"
        icon={IconArrowBackUp}
        disabled={!edits.canUndo}
        onClick={undo}
      />
      <Tool
        label="Повторить (Ctrl+Shift+Z)"
        icon={IconArrowForwardUp}
        disabled={!edits.canRedo}
        onClick={redo}
      />
      <Tool
        label="Сбросить к расстановке сервиса"
        icon={IconRestore}
        disabled={edits.counts.total === 0}
        onClick={() => {
          setResetting(true);
        }}
      />
      <Divider orientation="vertical" />
      <Text size="sm" className={classes.count}>
        {`Правок: ${formatNumber(edits.counts.total)}`}
      </Text>
      {storage}
      <Modal
        opened={resetting}
        onClose={() => {
          setResetting(false);
        }}
        title="Сбросить к расстановке сервиса?"
      >
        <Stack gap="lg">
          <Text>Все правки будут отменены. Сброс можно отменить кнопкой «Отменить».</Text>
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              onClick={() => {
                setResetting(false);
              }}
            >
              Оставить правки
            </Button>
            <Button
              color="clay"
              onClick={() => {
                setResetting(false);
                dispatch(actions.reset({ projectId }));
              }}
            >
              Сбросить
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Group>
  );
}

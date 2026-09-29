import {
  ActionIcon,
  Button,
  Divider,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
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
  // Выбран инструмент добавления: фокус уходит на карту, и Enter ставит посадку в центр
  // перекрестия. Иначе фокус оставался бы на кнопке, и Enter снимал бы инструмент.
  onToolPicked: () => void;
};

// Подсказка инструмента добавления: и мышь, и клавиатура (Enter ставит в центр перекрестия).
const placeHint = (what: string) =>
  `${what}: щёлкните по карте или нажмите Enter — посадка встанет в центр`;
// Предел имени версии в контракте (PlantingEdit.name).
const VERSION_NAME_MAX = 200;

type ToolProps = {
  label: string;
  icon: typeof IconTree;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  // Как выполнить действие, если одной кнопки мало: видно в подсказке вместо названия, слышно
  // в описании.
  hint?: string;
};

// Подсказка — под кнопкой: панель прижата к верху карты, и над ней подсказка ушла бы за карту.
function Tool({ label, icon, onClick, disabled = false, pressed, hint }: ToolProps): JSX.Element {
  const hintId = useId();
  return (
    <Tooltip label={hint ?? label} position="bottom">
      <ActionIcon
        aria-describedby={hint === undefined ? undefined : hintId}
        variant={pressed === true ? 'light' : 'subtle'}
        size="lg"
        className={classes.tool}
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
  onToolPicked,
}: EditToolbarProps): JSX.Element {
  const dispatch = useAppDispatch();
  const mode = useEditMode(projectId);
  const edits = usePlantingEdits(projectId, source);
  const { save, saving } = useSavePlantings(projectId, source);
  const [resetting, setResetting] = useState(false);
  const [naming, setNaming] = useState(false);
  const [versionName, setVersionName] = useState('');
  const saveVersion = () => {
    void save(versionName).then((error) => {
      if (error !== null) {
        notifications.show({ color: 'clay', message: describeAppError(error) });
        return;
      }
      setNaming(false);
      setVersionName('');
    });
  };

  const undo = () => dispatch(actions.undone({ projectId }));
  const redo = () => dispatch(actions.redone({ projectId }));
  const toggleTool = (tool: 'tree' | 'shrub') => {
    const picked = mode.tool !== tool;
    mode.setTool(picked ? tool : 'select');
    if (picked) onToolPicked();
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
          // Сохранять нечего — тихая недоступная кнопка без заливки, как у всех недоступных
          // тихих кнопок темы; filled — только когда правки есть.
          variant={(edits.unsaved && !edits.switching) || saving ? 'filled' : 'subtle'}
          loading={saving}
          disabled={!edits.unsaved || edits.switching}
          onClick={() => {
            setNaming(true);
          }}
        >
          Сохранить
        </Button>
      );
      break;
    case 'draft':
      storage = (
        <Text size="sm" c="dimmed" className={classes.storage}>
          Черновик в этом браузере
        </Text>
      );
      break;
    case 'memory':
      storage = (
        <Text size="sm" c="dimmed" className={classes.storage}>
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
        hint={placeHint('Дерево')}
        icon={IconTree}
        pressed={mode.tool === 'tree'}
        onClick={() => {
          toggleTool('tree');
        }}
      />
      <Tool
        label="Добавить кустарник"
        hint={placeHint('Кустарник')}
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
        {edits.counts.total === 0 ? 'Правок нет' : `Правок: ${formatNumber(edits.counts.total)}`}
      </Text>
      {storage}
      <Modal
        opened={naming}
        onClose={() => {
          setNaming(false);
        }}
        title="Сохранить правки"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            saveVersion();
          }}
        >
          <Stack gap="lg">
            <Text>
              Правки станут новой версией плана посадок. Прежние версии остаются, к ним можно
              вернуться в шапке проекта.
            </Text>
            <TextInput
              label="Имя версии"
              description="Необязательно. Видно в списке версий."
              maxLength={VERSION_NAME_MAX}
              value={versionName}
              onChange={(event) => {
                setVersionName(event.currentTarget.value);
              }}
              data-autofocus
            />
            <Group justify="flex-end" gap="sm">
              <Button
                variant="default"
                onClick={() => {
                  setNaming(false);
                }}
              >
                Отмена
              </Button>
              <Button type="submit" loading={saving}>
                Сохранить
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
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

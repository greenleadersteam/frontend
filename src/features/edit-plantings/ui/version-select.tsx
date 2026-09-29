import { Group, Select, Text } from '@mantine/core';
import { type JSX, useId } from 'react';

import type { PlantingVersion } from '@/entities/project';
import { formatDate } from '@/shared/lib/format';
import { useAppDispatch } from '@/shared/lib/store';

import { plantingEditsActions as actions } from '../model/edits';
import { useEditMode } from '../model/use-edit-mode';
import { usePlantingVersions } from '../model/use-planting-edits';
import classes from './version-select.module.css';

const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

// «1 — расстановка сервиса», «2 — правки 28 сентября, 14:30 (Вариант у школы)». Имя дал
// автор правки — оно выводится текстом.
export function versionLabel({ id, kind, name, created_at: createdAt }: PlantingVersion): string {
  const title =
    kind === 'auto'
      ? 'расстановка сервиса'
      : `правки ${formatDate(createdAt)}, ${time.format(new Date(createdAt))}`;
  // Имя есть у каждой версии: у первой — «Автоматическая посадка», у правки без имени —
  // «Версия N» (../backend/greenplan/api/plantings.py). Такие имена номер и вид не дополняют.
  const named = kind === 'manual' && name !== `Версия ${String(id)}`;
  return `${String(id)} — ${title}${named ? ` (${name})` : ''}`;
}

type VersionSelectProps = { projectId: string };

// Версия плана посадок в шапке экрана (plantingEdits). План, ведомость, отчёт и DXF — по ней.
// В режиме правки и с несохранёнными правками версию не сменить: правки относятся к той, что
// на экране, и смена стёрла бы их без возврата.
export function VersionSelect({ projectId }: VersionSelectProps): JSX.Element | null {
  const dispatch = useAppDispatch();
  const { list, target, fetching } = usePlantingVersions(projectId);
  const mode = useEditMode(projectId);
  const inputId = useId();
  if (list === null || target === null) return null;
  const options = list.map((version) => ({
    value: String(version.id),
    label: versionLabel(version),
  }));

  return (
    <Group gap="xs" wrap="nowrap">
      <Text component="label" htmlFor={inputId} size="sm" c="dimmed" className={classes.label}>
        Версия:
      </Text>
      <Select
        id={inputId}
        className={classes.select}
        data={options}
        value={String(target)}
        // Имя версии длиннее поля: полная подпись — в подсказке.
        title={options.find(({ value }) => value === String(target))?.label}
        allowDeselect={false}
        disabled={mode.editing || mode.unsaved || fetching}
        comboboxProps={{ width: 'max-content', position: 'bottom-end' }}
        onChange={(value) => {
          if (value === null) return;
          dispatch(actions.versionSelected({ projectId, version: Number(value) }));
        }}
      />
    </Group>
  );
}

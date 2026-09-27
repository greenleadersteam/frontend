import { ActionIcon, Button, Group, Menu, Popover, Stack, Table, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconDots } from '@tabler/icons-react';
import { type JSX, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import {
  archiveAction,
  downloadProjectDxf,
  GEOREFERENCE_CONFIDENCE_LABELS,
  getProcessingDurationMs,
  isProcessing,
  type Project,
  ProjectStatusBadge,
} from '@/entities/project';
import { deleteAvailability, DeleteProjectModal } from '@/features/delete-project';
import { EditModeButton } from '@/features/edit-plantings';
import { describeAppError } from '@/shared/api';
import { FOCUS_PROJECTS_HEADING, paths, projectUploadPath } from '@/shared/config';
import { formatCount, formatDuration, formatMeters } from '@/shared/lib/format';
import { Icon } from '@/shared/ui';

import classes from './project-header.module.css';

type ProjectHeaderProps = {
  project: Project;
  polling: { stalled: boolean; checkedAt: number };
};

export function ProjectHeader({ project, polling }: ProjectHeaderProps): JSX.Element {
  const { state, job } = project;
  const duration = state.kind === 'ready' ? getProcessingDurationMs(job) : null;

  return (
    <header className={classes.header}>
      <Button
        component={Link}
        to={paths.projects}
        variant="subtle"
        leftSection={<Icon icon={IconArrowLeft} tone="accent" />}
        className={classes.back}
      >
        Проекты
      </Button>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xl">
        <Stack gap="sm" className={classes.summary}>
          <Title order={1} lineClamp={2}>
            {project.name}
          </Title>
          <Group gap="sm">
            <ProjectStatusBadge
              state={state}
              progressPct={isProcessing(state) ? job.progress_pct : undefined}
            />
            {duration !== null && (
              <Text size="sm" c="dimmed">{`обработано за ${formatDuration(duration)}`}</Text>
            )}
            {state.kind === 'ready' && (
              <GeoreferenceButton georeference={job.georeference ?? null} />
            )}
          </Group>
          {project.description !== null && <Text c="dimmed">{project.description}</Text>}
        </Stack>
        <Group gap="sm" wrap="nowrap">
          {/* Кнопка правки есть, только когда правки загружены и не устарели. */}
          {state.kind === 'ready' && <EditModeButton projectId={project.id} />}
          {state.kind === 'ready' && <DownloadDxfButton project={project} />}
          <ProjectMenu project={project} polling={polling} />
        </Group>
      </Group>
    </header>
  );
}

type Georeference = NonNullable<Project['job']['georeference']>;

type GeoreferenceButtonProps = { georeference: Georeference | null };

// Список невязок по точкам показывается, пока он читается глазами.
const RESIDUALS_LIST_LIMIT = 20;
// Порог сервера по умолчанию (../backend/greenplan/api/config.py:33); в контуре его меняют
// переменной окружения, а в ответе API его нет.
const RESIDUAL_LIMIT_M = 1;
const POINT_FORMS = { one: 'опорная точка', few: 'опорные точки', many: 'опорных точек' };

function GeoreferenceButton({ georeference }: GeoreferenceButtonProps): JSX.Element {
  const confidence =
    georeference === null ? null : GEOREFERENCE_CONFIDENCE_LABELS[georeference.confidence];
  const residuals = Object.entries(georeference?.residuals_m ?? {});
  const values = residuals.map(([, value]) => value);

  return (
    <Popover position="bottom-start" shadow="md">
      <Popover.Target>
        <Button variant="subtle" size="compact-sm">
          {georeference === null ? 'Без геопривязки' : `Геопривязка: ${confidence ?? 'есть'}`}
        </Button>
      </Popover.Target>
      <Popover.Dropdown className={classes.georeference}>
        {georeference === null ? (
          <Text size="sm">
            Чертёж не привязан к городу: план показан в координатах чертежа, без подложки.
            Расстояния на плане — в метрах чертежа.
          </Text>
        ) : (
          <Stack gap="xs">
            <Text size="sm" className={classes.numbers}>
              {`Совпало: ${formatCount(georeference.matched_labels.length, POINT_FORMS)}`}
            </Text>
            {values.length > 0 && (
              <Text size="sm" className={classes.numbers}>
                {`Невязка наибольшая ${formatMeters(Math.max(...values))}, средняя ${formatMeters(values.reduce((sum, value) => sum + value, 0) / values.length)}`}
              </Text>
            )}
            {residuals.length > 0 && residuals.length <= RESIDUALS_LIST_LIMIT && (
              <Table className={classes.numbers}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Опорная точка</Table.Th>
                    <Table.Th>Невязка</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {residuals.map(([label, value]) => (
                    <Table.Tr key={label}>
                      <Table.Td>{label}</Table.Td>
                      <Table.Td>{formatMeters(value)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
            {/* Невязка — остаток подгонки поворота и сдвига по опорным точкам
                (../backend/greenplan/cli.py:45-48). */}
            <Text size="sm" c="dimmed">
              {`Невязка — расхождение между опорной точкой чертежа после привязки и координатами этого геодезического пункта. По умолчанию сервер отклоняет привязку, если невязка больше ${formatMeters(RESIDUAL_LIMIT_M)}.`}
            </Text>
            {georeference.confidence === 'unvalidated' && (
              <Text size="sm" c="dimmed">
                По двум точкам привязка строится без запаса, поэтому невязки её не подтверждают.
              </Text>
            )}
          </Stack>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}

type DownloadDxfButtonProps = { project: Project };

function DownloadDxfButton({ project }: DownloadDxfButtonProps): JSX.Element {
  const [loading, setLoading] = useState(false);

  const download = async () => {
    setLoading(true);
    const error = await downloadProjectDxf(project);
    setLoading(false);
    if (error !== null) {
      notifications.show({ color: 'clay', message: describeAppError(error) });
    }
  };

  return (
    <Button loading={loading} onClick={() => void download()}>
      Скачать DXF
    </Button>
  );
}

type ProjectMenuProps = ProjectHeaderProps;

function ProjectMenu({ project, polling }: ProjectMenuProps): JSX.Element {
  const [deleteOpened, setDeleteOpened] = useState(false);
  const hintId = useId();
  const navigate = useNavigate();
  const archive = archiveAction(project.state);
  const deletion = deleteAvailability(project, polling);

  return (
    <>
      <Menu position="bottom-end">
        <Menu.Target>
          <ActionIcon variant="default" size="lg" aria-label="Действия с проектом">
            <Icon icon={IconDots} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          {/* Выбор главного чертежа стоит на самом экране: пункт, уводящий в мастер, не нужен. */}
          {archive === 'upload' && (
            <Menu.Item component={Link} to={projectUploadPath(project.id)}>
              Загрузить архив
            </Menu.Item>
          )}
          <Menu.Item
            disabled={deletion.locked}
            aria-describedby={deletion.locked ? hintId : undefined}
            onClick={() => {
              setDeleteOpened(true);
            }}
          >
            Удалить проект
          </Menu.Item>
          {deletion.locked && (
            <Text id={hintId} size="xs" c="dimmed" className={classes.menuHint}>
              Удалить можно после завершения обработки
            </Text>
          )}
        </Menu.Dropdown>
      </Menu>
      <DeleteProjectModal
        project={project}
        opened={deleteOpened}
        onClose={() => {
          setDeleteOpened(false);
        }}
        hang={deletion.locked ? null : deletion.hang}
        onDeleted={() => {
          void navigate(paths.projects, { replace: true, state: FOCUS_PROJECTS_HEADING });
        }}
      />
    </>
  );
}

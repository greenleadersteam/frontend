import { ActionIcon, Button, Group, Menu, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconDots } from '@tabler/icons-react';
import { type JSX, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import {
  archiveAction,
  downloadProjectDxf,
  getProcessingDurationMs,
  isProcessing,
  type Project,
  ProjectStatusBadge,
} from '@/entities/project';
import { deleteAvailability, DeleteProjectModal } from '@/features/delete-project';
import { describeAppError } from '@/shared/api';
import { FOCUS_PROJECTS_HEADING, paths, projectUploadPath } from '@/shared/config';
import { formatDuration } from '@/shared/lib/format';
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
        leftSection={<Icon icon={IconArrowLeft} accent />}
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
          </Group>
          {project.description !== null && <Text c="dimmed">{project.description}</Text>}
        </Stack>
        <Group gap="sm" wrap="nowrap">
          {state.kind === 'ready' && <DownloadDxfButton project={project} />}
          <ProjectMenu project={project} polling={polling} />
        </Group>
      </Group>
    </header>
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
          {archive !== null && (
            <Menu.Item component={Link} to={projectUploadPath(project.id)}>
              {archive === 'upload' ? 'Загрузить архив' : 'Выбрать главный чертёж'}
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

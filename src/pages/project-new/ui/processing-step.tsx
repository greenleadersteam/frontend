import { Button, Group, Loader, Stack, Text, VisuallyHidden } from '@mantine/core';
import { IconCircleCheck } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link } from 'react-router';

import {
  getProcessingDurationMs,
  JOB_ERROR_LABELS,
  PollingStalledAlert,
  ProcessingStages,
  type Project,
  STAGE_LABELS,
  useProjectWithPolling,
} from '@/entities/project';
import { ChooseRootDxf } from '@/features/choose-root-dxf';
import { describeAppError, toAppError } from '@/shared/api';
import { paths, projectPath } from '@/shared/config';
import { formatDuration } from '@/shared/lib/format';

import classes from './processing-step.module.css';

type ProcessingStepProps = {
  projectId: string;
  acceptedAt: number;
  onUploadAnother: () => void;
};

export function ProcessingStep({
  projectId,
  acceptedAt,
  onUploadAnother,
}: ProcessingStepProps): JSX.Element {
  const {
    data: project,
    error,
    notFound,
    fulfilledTimeStamp,
    pollingStalled,
    checkAgain,
    refetch,
    isFetching,
  } = useProjectWithPolling(projectId);
  const fresh =
    project !== undefined && fulfilledTimeStamp !== undefined && fulfilledTimeStamp >= acceptedAt;

  if (notFound) {
    return (
      <Text role="alert" className={classes.error}>
        Проект не найден: возможно, его удалили. Вернитесь к списку проектов.
      </Text>
    );
  }
  if (!fresh && error !== undefined) {
    return (
      <Stack gap="md" align="flex-start">
        <Text role="alert" className={classes.error}>
          {describeAppError(toAppError(error))}
        </Text>
        <Button variant="default" loading={isFetching} onClick={() => void refetch()}>
          Повторить
        </Button>
      </Stack>
    );
  }

  // После повторной загрузки в кэше ещё лежит прошлая ошибка обработки: ждём ответ,
  // полученный уже после 202, чтобы не показать её снова.
  if (
    project === undefined ||
    fulfilledTimeStamp === undefined ||
    fulfilledTimeStamp < acceptedAt
  ) {
    return <Loader size="sm" aria-label="Загрузка состояния проекта" />;
  }

  return (
    <>
      {/* Смена этапа, готовность и ошибка объявляются скринридеру (ui.md, «Доступность»). */}
      <VisuallyHidden aria-live="polite">{announcementOf(project)}</VisuallyHidden>
      <ProcessingState
        project={project}
        stalled={pollingStalled}
        onCheckAgain={checkAgain}
        onUploadAnother={onUploadAnother}
      />
    </>
  );
}

function announcementOf({ state }: Project): string {
  switch (state.kind) {
    case 'ready':
      return 'План посадок готов';
    // Остальные ошибки объявляет role="alert" у их текста, а эта — подпись выбора.
    case 'failed':
      return state.error?.code === 'ambiguous_root_dxf' ? JOB_ERROR_LABELS.ambiguous_root_dxf : '';
    case 'processing':
      return STAGE_LABELS[state.stage];
    case 'draft':
    case 'unknown':
      return '';
    default: {
      const unexpected: never = state;
      return unexpected;
    }
  }
}

type ProcessingStateProps = {
  project: Project;
  stalled: boolean;
  onCheckAgain: () => void;
  onUploadAnother: () => void;
};

function ProcessingState({
  project,
  stalled,
  onCheckAgain,
  onUploadAnother,
}: ProcessingStateProps): JSX.Element {
  switch (project.state.kind) {
    case 'ready':
      return <ProcessingDone project={project} />;
    case 'failed':
      return <ProcessingFailed project={project} onUploadAnother={onUploadAnother} />;
    case 'draft':
    case 'processing':
    case 'unknown':
      return (
        <ProcessingInProgress project={project} stalled={stalled} onCheckAgain={onCheckAgain} />
      );
    default: {
      const unexpected: never = project.state;
      return unexpected;
    }
  }
}

type ProcessingInProgressProps = {
  project: Project;
  stalled: boolean;
  onCheckAgain: () => void;
};

function ProcessingInProgress({
  project,
  stalled,
  onCheckAgain,
}: ProcessingInProgressProps): JSX.Element {
  return (
    <Stack gap="lg">
      {stalled && <PollingStalledAlert project={project} onCheckAgain={onCheckAgain} />}
      <ProcessingStages project={project} />
      <Stack gap="xs">
        <Group gap="sm">
          <Button component={Link} to={projectPath(project.id)}>
            Перейти к проекту
          </Button>
          <Button component={Link} to={paths.projects} variant="default">
            К списку проектов
          </Button>
        </Group>
        <Text size="sm" c="dimmed">
          Обработка продолжится, если уйти с этой страницы.
        </Text>
      </Stack>
    </Stack>
  );
}

type ProcessingDoneProps = { project: Project };

function ProcessingDone({ project }: ProcessingDoneProps): JSX.Element {
  const duration = getProcessingDurationMs(project.job);
  return (
    <Stack gap="md" align="flex-start">
      <IconCircleCheck size={32} stroke={1.5} aria-hidden className={classes.doneIcon} />
      <Text className={classes.doneTitle}>План посадок готов</Text>
      {duration !== null && <Text c="dimmed">{`обработано за ${formatDuration(duration)}`}</Text>}
      <Button component={Link} to={projectPath(project.id)}>
        Открыть проект
      </Button>
    </Stack>
  );
}

type ProcessingFailedProps = {
  project: Project;
  onUploadAnother: () => void;
};

function ProcessingFailed({ project, onUploadAnother }: ProcessingFailedProps): JSX.Element {
  const error = project.state.kind === 'failed' ? project.state.error : null;
  if (error?.code === 'ambiguous_root_dxf') {
    return (
      <ChooseRootDxf
        projectId={project.id}
        candidates={error.candidates ?? []}
        uploadAnother={(variant) => (
          <Button variant={variant} onClick={onUploadAnother}>
            Загрузить другой архив
          </Button>
        )}
      />
    );
  }
  return (
    <Stack gap="md" align="flex-start">
      <Text role="alert" className={classes.error}>
        {JOB_ERROR_LABELS[error?.code ?? 'other']}
      </Text>
      <Button onClick={onUploadAnother}>Загрузить другой архив</Button>
    </Stack>
  );
}

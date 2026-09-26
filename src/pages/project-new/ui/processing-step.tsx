import {
  Alert,
  Button,
  Group,
  Loader,
  Progress,
  Radio,
  Stack,
  Text,
  VisuallyHidden,
} from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { IconCheck, IconCircleCheck } from '@tabler/icons-react';
import { type JSX, useState } from 'react';
import { Link } from 'react-router';

import {
  getProcessingDurationMs,
  JOB_ERROR_LABELS,
  PROCESSING_STAGES,
  type Project,
  STAGE_LABELS,
  useProjectWithPolling,
  useRunProjectMutation,
} from '@/entities/project';
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
    // Ошибку объявляет role="alert" у её текста — второй раз не повторяем.
    case 'failed':
      return '';
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
      return <ProcessingStages project={project} stalled={stalled} onCheckAgain={onCheckAgain} />;
    default: {
      const unexpected: never = project.state;
      return unexpected;
    }
  }
}

type ProcessingStagesProps = {
  project: Project;
  stalled: boolean;
  onCheckAgain: () => void;
};

function ProcessingStages({ project, stalled, onCheckAgain }: ProcessingStagesProps): JSX.Element {
  const reduceMotion = useReducedMotion();
  const current = project.state.kind === 'processing' ? project.state.stage : null;

  // Геопривязка идёт, только если у проекта есть область участка: этап показывается,
  // когда бэкенд до него дошёл. Опрос раз в 2 с может его проскочить — поэтому запоминаем.
  const [sawGeoreferencing, setSawGeoreferencing] = useState(false);
  if (current === 'georeferencing' && !sawGeoreferencing) setSawGeoreferencing(true);
  const stages = PROCESSING_STAGES.filter(
    (stage) => stage !== 'georeferencing' || sawGeoreferencing,
  );
  const currentIndex = current === null ? -1 : stages.indexOf(current);

  return (
    <Stack gap="lg">
      {stalled && (
        <Alert color="ochre" variant="light">
          <Group justify="space-between" gap="md">
            <Text size="sm">
              {current === 'queued'
                ? 'Обработка не началась за 30 минут.'
                : 'Обработка идёт дольше обычного.'}
            </Text>
            <Button variant="default" size="xs" onClick={onCheckAgain}>
              Проверить снова
            </Button>
          </Group>
        </Alert>
      )}

      <ol className={classes.stages} aria-label="Этапы обработки">
        {stages.map((stage, index) => {
          const status =
            index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'pending';
          return (
            <li key={stage} className={classes.stage} data-status={status}>
              <span className={classes.stageMark} aria-hidden>
                {status === 'done' && <IconCheck size={20} stroke={1.5} />}
                {status === 'current' && (
                  <Loader size="xs" color="sage.7" type={reduceMotion ? 'dots' : 'oval'} />
                )}
              </span>
              <Text component="span" size="md">
                {STAGE_LABELS[stage]}
              </Text>
              {status !== 'pending' && (
                <VisuallyHidden component="span">
                  {status === 'done' ? ', пройден' : ', выполняется'}
                </VisuallyHidden>
              )}
            </li>
          );
        })}
      </ol>

      <Progress value={project.job.progress_pct} aria-label="Ход обработки" />

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
      <RootDxfChoice
        projectId={project.id}
        candidates={error.candidates ?? []}
        onUploadAnother={onUploadAnother}
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

type RootDxfChoiceProps = {
  projectId: string;
  candidates: string[];
  onUploadAnother: () => void;
};

// Выбор главного DXF — повторная обработка через POST /runs с root_dxf (контракт-предложение).
// Кандидаты — только из ответа бэкенда, пути выводятся текстом.
function RootDxfChoice({
  projectId,
  candidates,
  onUploadAnother,
}: RootDxfChoiceProps): JSX.Element {
  const [rootDxf, setRootDxf] = useState<string | null>(null);
  const [runProject, { isLoading, error }] = useRunProjectMutation();

  return (
    <Stack gap="md" align="flex-start">
      <Radio.Group
        label={JOB_ERROR_LABELS.ambiguous_root_dxf}
        value={rootDxf}
        onChange={setRootDxf}
      >
        <Stack gap="sm" className={classes.candidates}>
          {candidates.map((path) => (
            <Radio key={path} value={path} label={path} />
          ))}
        </Stack>
      </Radio.Group>
      {error !== undefined && (
        <Text size="sm" role="alert" className={classes.error}>
          {describeAppError(toAppError(error))}
        </Text>
      )}
      {/* Второй путь — новый архив: /runs пока есть только в контракте-предложении. */}
      <Group gap="sm">
        <Button
          disabled={rootDxf === null}
          loading={isLoading}
          onClick={() => {
            if (rootDxf !== null)
              void runProject({ id: projectId, request: { root_dxf: rootDxf } });
          }}
        >
          Продолжить обработку
        </Button>
        <Button variant="default" onClick={onUploadAnother}>
          Загрузить другой архив
        </Button>
      </Group>
    </Stack>
  );
}

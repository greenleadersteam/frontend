import { Button, Stack, Text, VisuallyHidden } from '@mantine/core';
import { type JSX, useState } from 'react';
import { useParams } from 'react-router';

import {
  isProcessing,
  isProjectId,
  JOB_ERROR_LABELS,
  type Project,
  STAGE_LABELS,
  useProjectWithPolling,
} from '@/entities/project';
import { describeAppError, toAppError } from '@/shared/api';
import { PRODUCT_NAME } from '@/shared/config';
import { NotFoundScreen, PageLoader } from '@/shared/ui';

import { ProjectBody } from './project-body';
import { ProjectHeader } from './project-header';
import classes from './project-page.module.css';

export function ProjectPage(): JSX.Element {
  const { projectId } = useParams();
  if (!isProjectId(projectId)) {
    return <NotFoundScreen />;
  }
  return <ProjectScreen key={projectId} id={projectId} />;
}

type ProjectScreenProps = { id: string };

function ProjectScreen({ id }: ProjectScreenProps): JSX.Element {
  const {
    data: project,
    error,
    notFound,
    isFetching,
    refetch,
    fulfilledTimeStamp,
    pollingStalled,
    checkAgain,
  } = useProjectWithPolling(id);

  // «План посадок готов» объявляется, только если готовность наступила на глазах
  // у пользователя, а не при открытии уже готового проекта.
  const [sawProcessing, setSawProcessing] = useState(false);
  if (project !== undefined && isProcessing(project.state) && !sawProcessing) {
    setSawProcessing(true);
  }

  if (notFound) return <NotFoundScreen />;
  if (project === undefined) {
    // Лоадер — прямо в области содержимого: так он встаёт по центру свободного места.
    return error === undefined ? (
      <>
        <title>{`Проект — ${PRODUCT_NAME}`}</title>
        <PageLoader />
      </>
    ) : (
      <div className={classes.content}>
        <title>{`Проект — ${PRODUCT_NAME}`}</title>
        <Stack gap="md" align="flex-start">
          <Text role="alert">{describeAppError(toAppError(error))}</Text>
          <Button variant="default" loading={isFetching} onClick={() => void refetch()}>
            Повторить
          </Button>
        </Stack>
      </div>
    );
  }

  return (
    <div className={classes.page}>
      <title>{`${project.name} — ${PRODUCT_NAME}`}</title>
      <VisuallyHidden aria-live="polite">{announcementOf(project, sawProcessing)}</VisuallyHidden>
      <ProjectHeader
        project={project}
        polling={{ stalled: pollingStalled, checkedAt: fulfilledTimeStamp ?? 0 }}
      />
      <ProjectBody project={project} stalled={pollingStalled} onCheckAgain={checkAgain} />
    </div>
  );
}

function announcementOf({ state }: Project, sawProcessing: boolean): string {
  switch (state.kind) {
    case 'processing':
      return STAGE_LABELS[state.stage];
    case 'ready':
      return sawProcessing ? 'План посадок готов' : '';
    // Остальные ошибки объявляет role="alert" у их текста, а эта — подпись выбора.
    case 'failed':
      return state.error?.code === 'ambiguous_root_dxf' ? JOB_ERROR_LABELS.ambiguous_root_dxf : '';
    case 'draft':
    case 'unknown':
      return '';
    default: {
      const unexpected: never = state;
      return unexpected;
    }
  }
}

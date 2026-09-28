import { Button, Card, Group, Stack, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link } from 'react-router';

import {
  failedOnGeoreference,
  JOB_ERROR_LABELS,
  PollingStalledAlert,
  ProcessingStages,
  type Project,
} from '@/entities/project';
import { ChooseRootDxf } from '@/features/choose-root-dxf';
import { georeferenceProjectPath, projectUploadPath, useCapability } from '@/shared/config';
import { EmptyState } from '@/shared/ui';

import classes from './project-body.module.css';
import { ResultView } from './result-view';

type ProjectBodyProps = {
  project: Project;
  stalled: boolean;
  onCheckAgain: () => void;
};

export function ProjectBody({ project, stalled, onCheckAgain }: ProjectBodyProps): JSX.Element {
  switch (project.state.kind) {
    case 'draft':
      return (
        <div className={classes.content}>
          <EmptyState
            title="Архив не загружен"
            description="Загрузите ZIP с подосновой, чтобы сервис рассчитал посадки"
            action={
              <Button component={Link} to={projectUploadPath(project.id)}>
                Загрузить архив
              </Button>
            }
          />
        </div>
      );
    case 'processing':
    case 'unknown':
      return (
        <div className={classes.content}>
          <Stack gap="lg" className={classes.narrow}>
            {stalled && <PollingStalledAlert project={project} onCheckAgain={onCheckAgain} />}
            <Card>
              <ProcessingStages project={project} />
            </Card>
          </Stack>
        </div>
      );
    case 'failed':
      return <ProcessingFailed project={project} />;
    case 'ready':
      return <ResultView project={project} />;
    default: {
      const unexpected: never = project.state;
      return unexpected;
    }
  }
}

type ProcessingFailedProps = { project: Project };

function ProcessingFailed({ project }: ProcessingFailedProps): JSX.Element {
  const error = project.state.kind === 'failed' ? project.state.error : null;
  const uploadPath = projectUploadPath(project.id);
  // Ручная привязка нужна серверу: без PUT /georeference упавший проект её не примет.
  const manual = useCapability('manualGeoreference') && failedOnGeoreference(project.state);

  return (
    <div className={classes.content}>
      <Card className={classes.narrow}>
        <Stack gap="md" align="flex-start">
          <IconAlertTriangle size={32} stroke={1.5} aria-hidden className={classes.errorIcon} />
          {error?.code === 'ambiguous_root_dxf' ? (
            // Текст ошибки — подпись группы вариантов.
            <ChooseRootDxf
              projectId={project.id}
              candidates={error.candidates ?? []}
              uploadAnother={(variant) => (
                <Button component={Link} to={uploadPath} variant={variant}>
                  Загрузить другой архив
                </Button>
              )}
            />
          ) : (
            <>
              <Text role="alert">{JOB_ERROR_LABELS[error?.code ?? 'other']}</Text>
              {manual && (
                <Text c="dimmed">
                  Чертёж можно привязать к карте вручную: совместить границу участка с картой в
                  модуле геопривязки. После этого проект обработается заново.
                </Text>
              )}
              <Group gap="sm">
                {manual && (
                  <Button component={Link} to={georeferenceProjectPath(project.id)}>
                    Привязать вручную
                  </Button>
                )}
                <Button component={Link} to={uploadPath} variant={manual ? 'default' : 'filled'}>
                  Загрузить другой архив
                </Button>
              </Group>
            </>
          )}
        </Stack>
      </Card>
    </div>
  );
}

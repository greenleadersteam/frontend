import { Button, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { type JSX, type ReactNode, useState } from 'react';
import { Link } from 'react-router';

import {
  failedOnGeoreference,
  isGeographic,
  type Project,
  useGetObstaclesQuery,
  useGetPlantingQuery,
  useGetZonesQuery,
  useProjectWithPolling,
} from '@/entities/project';
import { describeAppError, toAppError } from '@/shared/api';
import { PRODUCT_NAME, projectPath, useCapability } from '@/shared/config';
import type { Contour } from '@/shared/lib/contour';
import { NotFoundScreen } from '@/shared/ui';

import { type ContourOrigin, obstaclesContour, projectContour } from '../lib/project-contour';
import { prepareOverlay, type ProjectOverlay } from '../lib/project-overlay';
import classes from './georeference-page.module.css';

// Модуль, открытый из проекта: контур — граница участка из результата обработки.
export type ProjectMode = {
  project: Project;
  // null — контура в данных проекта нет: пользователь загружает его файлом.
  contour: Contour | null;
  origin: ContourOrigin;
  // План проекта под контуром; у упавшего на геопривязке плана нет.
  overlay: ProjectOverlay | null;
};

type ProjectGeoreferenceProps = {
  id: string;
  children: (mode: ProjectMode) => ReactNode;
};

// Загрузка проекта и его результата для режима проекта; модуль получает готовый контур.
// Привязка проекта применяется только сервером (manualGeoreference): без него режима проекта
// нет, а модуль открыт в меню «Геопривязка» сам по себе.
export function ProjectGeoreference({ id, children }: ProjectGeoreferenceProps): JSX.Element {
  const manual = useCapability('manualGeoreference');
  const { data: project, error, notFound, isFetching, refetch } = useProjectWithPolling(id);
  if (notFound) return <NotFoundScreen />;
  if (project === undefined) {
    return error === undefined ? (
      <Loader size="sm" aria-label="Загрузка проекта" />
    ) : (
      <Unavailable
        text={describeAppError(toAppError(error))}
        action={
          <Button variant="default" loading={isFetching} onClick={() => void refetch()}>
            Повторить
          </Button>
        }
      />
    );
  }
  if (!manual) {
    return (
      <Unavailable
        project={project}
        text="Привязать проект к карте можно будет в следующей версии: сервер пока не принимает привязку из модуля. Без проекта модуль доступен в меню «Геопривязка»."
      />
    );
  }
  if (failedOnGeoreference(project.state)) {
    return <FailedProject project={project}>{children}</FailedProject>;
  }
  if (project.state.kind !== 'ready') {
    return (
      <Unavailable
        project={project}
        text="Привязать к карте можно проект, обработка которого завершена."
      />
    );
  }
  if (project.job.georeference != null) {
    return (
      <Unavailable
        project={project}
        text={
          project.job.georeference.confidence === 'manual'
            ? 'Привязка из модуля уже применена сервером, и план проекта показан на карте города. Изменить её пока нельзя: сервер не возвращает ни её параметры, ни координаты чертежа. Вернитесь к проекту.'
            : SERVER_GEOREFERENCE
        }
      />
    );
  }
  return <ProjectResult project={project}>{children}</ProjectResult>;
}

const SERVER_GEOREFERENCE =
  'Проект уже привязан к городу при обработке: его план показан на карте Москвы.';

type ProjectResultProps = { project: Project; children: (mode: ProjectMode) => ReactNode };

function ProjectResult({ project, children }: ProjectResultProps): JSX.Element {
  const zones = useGetZonesQuery(project.id);
  const planting = useGetPlantingQuery(project.id);
  const error = zones.error ?? planting.error;
  if (error !== undefined) {
    return (
      <Unavailable
        project={project}
        text={describeAppError(toAppError(error))}
        action={
          <Button
            variant="default"
            loading={zones.isFetching || planting.isFetching}
            onClick={() => {
              if (zones.isError) void zones.refetch();
              if (planting.isError) void planting.refetch();
            }}
          >
            Повторить
          </Button>
        }
      />
    );
  }
  if (zones.data === undefined || planting.data === undefined) {
    return <Loader size="sm" aria-label="Загрузка результата проекта" />;
  }
  if (isGeographic(zones.data.metadata.crs)) {
    return <Unavailable project={project} text={SERVER_GEOREFERENCE} />;
  }
  const chosen = projectContour(zones.data, planting.data, project.name);
  if (chosen === null) {
    return (
      <Unavailable
        project={project}
        text="В результате обработки нет ни границы участка, ни газона, ни посадок: совмещать с картой нечего."
      />
    );
  }
  const { contour, origin } = chosen;
  return (
    <>
      {children({
        project,
        contour,
        origin,
        overlay: prepareOverlay(zones.data, planting.data),
      })}
    </>
  );
}

type FailedProjectProps = { project: Project; children: (mode: ProjectMode) => ReactNode };

// Проект, упавший на геопривязке: результата нет, контур — граница участка из объектов подосновы
// (возможность obstacles), иначе — файл пользователя.
function FailedProject({ project, children }: FailedProjectProps): JSX.Element {
  const withObstacles = useCapability('obstacles');
  const obstacles = useGetObstaclesQuery(project.id, { skip: !withObstacles });
  // Сбой /obstacles — повторить или загрузить границу файлом: решает пользователь.
  const [fileInstead, setFileInstead] = useState(false);
  if (obstacles.isLoading) return <Loader size="sm" aria-label="Загрузка подосновы проекта" />;
  // 404 — подосновы у сервера для этого проекта нет: это не сбой, а случай «загрузите файлом».
  const error = obstacles.error;
  const absent = error !== undefined && 'status' in error && error.status === 404;
  if (error !== undefined && !absent && !fileInstead) {
    return (
      <Unavailable
        project={project}
        text={describeAppError(toAppError(error))}
        action={
          <Group gap="sm">
            <Button
              variant="default"
              loading={obstacles.isFetching}
              onClick={() => void obstacles.refetch()}
            >
              Повторить
            </Button>
            <Button
              variant="subtle"
              onClick={() => {
                setFileInstead(true);
              }}
            >
              Загрузить границу файлом
            </Button>
          </Group>
        }
      />
    );
  }
  const found =
    obstacles.data === undefined ? null : obstaclesContour(obstacles.data, project.name);
  const origin: ContourOrigin =
    found === null
      ? !withObstacles || absent
        ? 'fileNoObstacles'
        : 'fileObstaclesFailed'
      : found.kind === 'contour'
        ? 'obstacles'
        : found.kind === 'missing'
          ? 'fileMissing'
          : found.kind === 'open'
            ? 'fileOpen'
            : 'fileInvalid';
  return (
    <>
      {children({
        project,
        contour: found?.kind === 'contour' ? found.contour : null,
        origin,
        overlay: null,
      })}
    </>
  );
}

type UnavailableProps = { project?: Project; text: string; action?: ReactNode };

function Unavailable({ project, text, action }: UnavailableProps): JSX.Element {
  return (
    <Stack gap="md" align="flex-start" className={classes.unavailable}>
      <title>{`Геопривязка — ${PRODUCT_NAME}`}</title>
      <Title order={1}>{project === undefined ? 'Привязка к карте' : project.name}</Title>
      <Text role={action === undefined ? undefined : 'alert'}>{text}</Text>
      {action}
      {project !== undefined && (
        <Button component={Link} to={projectPath(project.id)} variant="default">
          Назад к проекту
        </Button>
      )}
    </Stack>
  );
}

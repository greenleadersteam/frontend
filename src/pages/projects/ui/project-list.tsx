import { Alert, Button, Card, Group, Skeleton, Stack, Text, Title } from '@mantine/core';
import { type JSX, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';

import { useProjectsWithPolling } from '@/entities/project';
import { describeAppError, toAppError } from '@/shared/api';
import { isFocusProjectsHeading, paths } from '@/shared/config';
import { formatCount } from '@/shared/lib/format';
import { EmptyState } from '@/shared/ui';

import { ProjectCard } from './project-card';
import classes from './project-list.module.css';

const PROJECT_FORMS = { one: 'проект', few: 'проекта', many: 'проектов' };
const SKELETON_IDS = ['a', 'b', 'c', 'd', 'e', 'f'];

function ProjectCardSkeleton(): JSX.Element {
  return (
    <Card padding={0}>
      <Skeleton className={classes.skeletonPreview} />
      <Stack gap="sm" className={classes.skeletonBody}>
        <Skeleton height="1.5rem" width="45%" radius="xl" />
        <Skeleton height="1rem" width="80%" />
        <Skeleton height="0.75rem" width="35%" />
      </Stack>
    </Card>
  );
}

export function ProjectList(): JSX.Element {
  const { data, error, isFetching, fulfilledTimeStamp, refetch, pollingStalled, checkAgain } =
    useProjectsWithPolling();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const navigationState: unknown = useLocation().state;

  // Проект удалён с его экрана: фокус с исчезнувшей кнопки переходит на заголовок списка.
  useEffect(() => {
    if (isFocusProjectsHeading(navigationState)) headingRef.current?.focus();
  }, [navigationState]);
  const projects =
    data === undefined
      ? undefined
      : [...data].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="flex-start">
        <Stack gap="xs">
          <Title order={1} ref={headingRef} tabIndex={-1} className={classes.heading}>
            Проекты
          </Title>
          {projects !== undefined && (
            <Text c="dimmed">{formatCount(projects.length, PROJECT_FORMS)}</Text>
          )}
        </Stack>
        {/* Главное действие одно на экран: в пустом состоянии его несёт EmptyState. */}
        {projects?.length !== 0 && (
          <Button component={Link} to={paths.projectNew}>
            Загрузить проект
          </Button>
        )}
      </Group>

      {/* error сбрасывается только успешным ответом, поэтому на время повторных запросов
          предупреждение не пропадает и не мигает. */}
      {projects !== undefined && error !== undefined && (
        <Alert color="ochre" variant="light">
          <Group justify="space-between" gap="md">
            <Text size="sm">Не удалось обновить статусы. Проверьте связь с сервером.</Text>
            <Button variant="default" size="xs" loading={isFetching} onClick={() => void refetch()}>
              Повторить
            </Button>
          </Group>
        </Alert>
      )}

      {pollingStalled && (
        <Alert color="ochre" variant="light">
          <Group justify="space-between" gap="md">
            <Text size="sm">Обработка идёт дольше обычного. Статусы могли устареть.</Text>
            <Button variant="default" size="xs" onClick={checkAgain}>
              Проверить снова
            </Button>
          </Group>
        </Alert>
      )}

      {projects === undefined ? (
        error !== undefined && !isFetching ? (
          <Stack gap="md" align="flex-start">
            <Text>{describeAppError(toAppError(error))}</Text>
            <Button variant="default" onClick={() => void refetch()}>
              Повторить
            </Button>
          </Stack>
        ) : (
          <div
            className={classes.grid}
            role="status"
            aria-busy="true"
            aria-label="Загрузка проектов"
          >
            {SKELETON_IDS.map((id) => (
              <ProjectCardSkeleton key={id} />
            ))}
          </div>
        )
      ) : projects.length === 0 ? (
        <EmptyState
          title="Проектов пока нет"
          description="Загрузите архив с подосновой и сетями — сервис предложит план посадок с обоснованием по нормам."
          action={
            <Button component={Link} to={paths.projectNew}>
              Загрузить проект
            </Button>
          }
        />
      ) : (
        <div className={classes.grid}>
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              stalled={pollingStalled}
              checkedAt={fulfilledTimeStamp ?? 0}
              onDeleted={() => headingRef.current?.focus()}
            />
          ))}
        </div>
      )}
    </Stack>
  );
}

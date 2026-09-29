import { Button, Group, Stack, Text, Title } from '@mantine/core';
import type { JSX } from 'react';
import { Link, useParams } from 'react-router';

import { isProjectId, type Project, useProjectWithPolling } from '@/entities/project';
import { DxfCheckForm } from '@/features/check-dxf';
import { usePlantingVersions } from '@/features/edit-plantings';
import { describeAppError, toAppError } from '@/shared/api';
import { PRODUCT_NAME, projectPath, useCapability } from '@/shared/config';
import { NotFoundScreen, PageLoader } from '@/shared/ui';

import classes from './dxf-check-page.module.css';

// Проверка чертежа: исходный DXF пользователя против DXF сервиса, по слоям.
export function DxfCheckPage(): JSX.Element {
  const { projectId } = useParams();
  if (!isProjectId(projectId)) return <NotFoundScreen />;
  return <DxfCheckScreen key={projectId} id={projectId} />;
}

type DxfCheckScreenProps = { id: string };

function DxfCheckScreen({ id }: DxfCheckScreenProps): JSX.Element {
  const { data: project, error, notFound } = useProjectWithPolling(id);
  if (notFound) return <NotFoundScreen />;
  if (project === undefined) {
    return error === undefined ? (
      <PageLoader />
    ) : (
      <Text role="alert">{describeAppError(toAppError(error))}</Text>
    );
  }
  return (
    <Stack gap="xl" className={classes.page}>
      <title>{`Проверка чертежа — ${project.name} — ${PRODUCT_NAME}`}</title>
      <Stack gap="xs">
        <Text c="dimmed">Проверка чертежа</Text>
        <Title order={1}>{project.name}</Title>
      </Stack>
      {project.state.kind === 'ready' ? (
        <VersionedForm project={project} />
      ) : (
        <Text>Проверить чертёж можно, когда обработка проекта завершена.</Text>
      )}
      <Group>
        <Button component={Link} to={projectPath(project.id)} variant="default">
          Назад к проекту
        </Button>
      </Group>
    </Stack>
  );
}

type VersionedFormProps = { project: Project };

// С версиями проверяется DXF версии, выбранной в шапке проекта. Без списка версий /dxf отдал бы
// последнюю под видом выбранной — проверка ждёт список.
function VersionedForm({ project }: VersionedFormProps): JSX.Element {
  const withVersions = useCapability('plantingEdits');
  const { target, error, fetching, retry } = usePlantingVersions(project.id);
  const blocked =
    !withVersions || target !== null
      ? null
      : error === undefined
        ? 'Загружается список версий плана посадок'
        : describeAppError(toAppError(error));
  return (
    <DxfCheckForm
      project={project}
      version={withVersions ? target : null}
      blocked={blocked}
      retry={
        withVersions && target === null && error !== undefined
          ? { run: retry, pending: fetching }
          : null
      }
    />
  );
}

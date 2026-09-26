import { Anchor, Button, Loader, Stack, Text, Title } from '@mantine/core';
import { type JSX, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { isProjectId, useProjectWithPolling } from '@/entities/project';
import { describeAppError, toAppError } from '@/shared/api';
import { paths, PRODUCT_NAME } from '@/shared/config';

import type { WizardEntry } from '../model/wizard';
import { UploadWizard } from './upload-wizard';

const NOT_FOUND = 'Проект не найден: возможно, его удалили. Вернитесь к списку проектов.';

export function ProjectNewPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const projectParam = searchParams.get('project');

  return (
    <>
      <title>{`Новый проект — ${PRODUCT_NAME}`}</title>
      {projectParam === null ? (
        <UploadWizard entry={null} />
      ) : isProjectId(projectParam) ? (
        <ExistingProjectWizard id={projectParam} />
      ) : (
        <Unavailable message={NOT_FOUND} />
      )}
    </>
  );
}

type ExistingProjectWizardProps = { id: string };

// Загрузка архива в существующий проект: допустима без архива и после ошибки обработки,
// как у бэкенда (../backend/greenplan/api/jobs.py:52). После ambiguous_root_dxf мастер
// открывается сразу на выборе главного DXF.
function ExistingProjectWizard({ id }: ExistingProjectWizardProps): JSX.Element {
  const { data, error, notFound, isFetching, refetch } = useProjectWithPolling(id);
  // Решение принимается один раз: после загрузки статус станет «идёт обработка»,
  // а мастер должен остаться на экране.
  const [entry, setEntry] = useState<WizardEntry | null>(null);
  if (entry === null && data !== undefined) {
    const project = { id: data.id, name: data.name, keepOnLeave: true };
    if (data.state.kind === 'draft') setEntry({ project, start: 'archive' });
    if (data.state.kind === 'failed') {
      const chooseRoot = data.state.error?.code === 'ambiguous_root_dxf';
      setEntry({ project, start: chooseRoot ? 'root-choice' : 'archive' });
    }
  }

  if (entry !== null) return <UploadWizard key={entry.project.id} entry={entry} />;
  if (notFound) return <Unavailable message={NOT_FOUND} />;
  if (data !== undefined) {
    return (
      <Unavailable message="В этот проект сейчас нельзя загрузить архив: обработка идёт или уже завершилась. Откройте проект из списка." />
    );
  }
  if (error !== undefined) {
    return (
      <Stack gap="md" align="flex-start">
        <Title order={1}>Загрузка архива</Title>
        <Text role="alert">{describeAppError(toAppError(error))}</Text>
        <Button variant="default" loading={isFetching} onClick={() => void refetch()}>
          Повторить
        </Button>
      </Stack>
    );
  }
  return <Loader size="sm" aria-label="Загрузка проекта" />;
}

type UnavailableProps = { message: string };

function Unavailable({ message }: UnavailableProps): JSX.Element {
  return (
    <Stack gap="md" align="flex-start">
      <Title order={1}>Загрузка архива</Title>
      <Text>{message}</Text>
      <Anchor component={Link} to={paths.projects}>
        К списку проектов
      </Anchor>
    </Stack>
  );
}

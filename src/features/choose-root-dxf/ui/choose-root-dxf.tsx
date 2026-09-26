import { Button, Group, Radio, Stack, Text } from '@mantine/core';
import { type JSX, type ReactNode, useState } from 'react';

import { JOB_ERROR_LABELS, useRunProjectMutation } from '@/entities/project';
import { describeAppError, toAppError } from '@/shared/api';

import classes from './choose-root-dxf.module.css';

type ChooseRootDxfProps = {
  projectId: string;
  candidates: string[];
  // Второе действие рядом с «Продолжить обработку», например «Загрузить другой архив».
  secondaryAction?: ReactNode;
};

// Выбор главного чертежа — повторная обработка через POST /runs с root_dxf
// (контракт-предложение). Кандидаты — только из ответа бэкенда, пути выводятся текстом.
// После 202 проект снова в обработке: тег проекта инвалидируется, опрос подхватывает этапы.
export function ChooseRootDxf({
  projectId,
  candidates,
  secondaryAction,
}: ChooseRootDxfProps): JSX.Element {
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
        {secondaryAction}
      </Group>
    </Stack>
  );
}

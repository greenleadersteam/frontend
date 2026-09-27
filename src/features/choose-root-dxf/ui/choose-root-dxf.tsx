import { Button, Group, List, Radio, Stack, Text } from '@mantine/core';
import { type JSX, type ReactNode, useEffect, useRef, useState } from 'react';

import { JOB_ERROR_LABELS, useRunProjectMutation } from '@/entities/project';
import { describeAppError, toAppError } from '@/shared/api';
import { useCapability } from '@/shared/config';

import classes from './choose-root-dxf.module.css';

const RUNS_UNSUPPORTED =
  'Сервер пока не умеет выбирать чертёж. Оставьте в архиве один главный чертёж и загрузите архив снова.';

type ChooseRootDxfProps = {
  projectId: string;
  candidates: string[];
  // «Загрузить другой архив»: второстепенное рядом с «Продолжить обработку» и главное, если
  // сервер выбирать не умеет.
  uploadAnother: (variant: 'filled' | 'default') => ReactNode;
};

// Выбор главного чертежа — повторная обработка через POST /runs с root_dxf
// (контракт-предложение). Кандидаты — только из ответа бэкенда, пути выводятся текстом.
// После 202 проект снова в обработке: тег проекта инвалидируется, опрос подхватывает этапы.
export function ChooseRootDxf({
  projectId,
  candidates,
  uploadAnother,
}: ChooseRootDxfProps): JSX.Element {
  const [rootDxf, setRootDxf] = useState<string | null>(null);
  const canRun = useCapability('runs');
  const [runProject, { isLoading, error }] = useRunProjectMutation();
  const appError = error === undefined ? null : toAppError(error);
  // Страховка: сервер объявил /runs, но ответил так, будто его нет.
  const rejectedByServer =
    appError?.kind === 'http' && (appError.status === 404 || appError.status === 405);
  const unsupported = !canRun || rejectedByServer;
  const unsupportedRef = useRef<HTMLParagraphElement>(null);

  // Кнопка, на которой был фокус, исчезает вместе с выбором: фокус переходит на объяснение,
  // и скринридер читает его при получении фокуса (role="alert" дал бы второе объявление).
  // Без возможности runs объяснение показано сразу, и фокус с места не уводится.
  useEffect(() => {
    if (rejectedByServer) unsupportedRef.current?.focus();
  }, [rejectedByServer]);

  // Без /runs бэкенд ждёт архив с одним главным чертежом. Список кандидатов подсказывает,
  // какие файлы конфликтуют. 404 от объявленного /runs значит и «проекта нет»: различить это
  // можно только по тексту detail, а он не контракт (вопрос к бэкенду). 405 — если бэкенд
  // объявит путь без POST.
  if (unsupported) {
    return (
      <Stack gap="md" align="flex-start">
        <Text ref={unsupportedRef} tabIndex={-1}>
          {RUNS_UNSUPPORTED}
        </Text>
        <List className={classes.candidates}>
          {candidates.map((path) => (
            <List.Item key={path}>{path}</List.Item>
          ))}
        </List>
        {uploadAnother('filled')}
      </Stack>
    );
  }

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
      {appError !== null && (
        <Text size="sm" role="alert" className={classes.error}>
          {describeAppError(appError)}
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
        {uploadAnother('default')}
      </Group>
    </Stack>
  );
}

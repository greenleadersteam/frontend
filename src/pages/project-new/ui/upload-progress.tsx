import { Button, Group, Progress, Stack, Text, VisuallyHidden } from '@mantine/core';
import type { JSX } from 'react';
import { Link } from 'react-router';

import { paths, projectPath } from '@/shared/config';
import { formatCount, formatTransferred } from '@/shared/lib/format';

import { describeUploadError } from '../model/use-archive-upload';
import { estimateRemainingSeconds, type UploadState } from '../model/wizard';
import classes from './upload-progress.module.css';

// Общий текст 409 советует обновить страницу, а это сбросит мастер: здесь свой текст.
const CONFLICT_TEXT =
  'Архив не принят: состояние проекта изменилось, возможно, в другой вкладке. Откройте проект, чтобы посмотреть его статус.';

type UploadProgressProps = {
  upload: Exclude<UploadState, { kind: 'idle' } | { kind: 'accepted' }>;
  onCancel: () => void;
  onRetry: () => void;
};

// «около» требует родительного падежа: «около 1 секунды», «около 5 секунд».
const SECONDS = { one: 'секунды', few: 'секунд', many: 'секунд' };
const MINUTES = { one: 'минуты', few: 'минут', many: 'минут' };

const remainingText = (seconds: number) =>
  seconds < 90
    ? `осталось около ${formatCount(seconds, SECONDS)}`
    : `осталось около ${formatCount(Math.round(seconds / 60), MINUTES)}`;

const percent = new Intl.NumberFormat('ru-RU', { style: 'percent' });

export function UploadProgress({ upload, onCancel, onRetry }: UploadProgressProps): JSX.Element {
  if (upload.kind === 'conflict') {
    return (
      <Stack gap="md" align="flex-start">
        <Text role="alert" className={classes.error}>
          {CONFLICT_TEXT}
        </Text>
        <Group gap="sm">
          <Button component={Link} to={projectPath(upload.projectId)}>
            Открыть проект
          </Button>
          <Button component={Link} to={paths.projects} variant="default">
            К списку проектов
          </Button>
        </Group>
      </Stack>
    );
  }
  if (upload.kind === 'failed') {
    return (
      <Stack gap="md" align="flex-start">
        <Text role="alert" className={classes.error}>
          {describeUploadError(upload.error)}
        </Text>
        <Group gap="sm">
          <Button onClick={onRetry}>Повторить загрузку</Button>
          <Button variant="default" onClick={onCancel}>
            Отменить загрузку
          </Button>
        </Group>
      </Stack>
    );
  }

  const sent = upload.kind === 'uploading' ? upload.sentBytes : 0;
  const total = upload.kind === 'uploading' ? upload.totalBytes : 0;
  const ratio = total === 0 ? 0 : sent / total;
  const remaining = estimateRemainingSeconds(upload);
  // Скринридеру — только шаг в 10 %, а не каждое событие прогресса (ui.md, «Доступность»).
  const announced = Math.floor(ratio * 10) / 10;

  return (
    <Stack gap="md">
      <Text className={classes.title}>
        {upload.kind === 'creating' ? 'Создаём проект' : 'Загружаем архив'}
      </Text>
      <Progress value={ratio * 100} aria-label="Загрузка архива" />
      <Group justify="space-between" className={classes.numbers}>
        <Text size="sm" c="dimmed">
          {total === 0 ? '' : formatTransferred(sent, total)}
        </Text>
        <Text size="sm" c="dimmed">
          {remaining === null ? '' : remainingText(remaining)}
        </Text>
      </Group>
      <VisuallyHidden aria-live="polite">
        {total === 0 ? '' : `Загружено ${percent.format(announced)}`}
      </VisuallyHidden>
      <Group>
        <Button variant="default" onClick={onCancel}>
          Отменить загрузку
        </Button>
      </Group>
    </Stack>
  );
}

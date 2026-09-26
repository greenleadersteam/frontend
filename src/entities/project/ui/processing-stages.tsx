import { Alert, Button, Group, Loader, Progress, Stack, Text, VisuallyHidden } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { IconCheck } from '@tabler/icons-react';
import { type JSX, useState } from 'react';

import { STAGE_LABELS } from '../config/labels';
import { PROCESSING_STAGES, type Project } from '../model/project';
import classes from './processing-stages.module.css';

type ProcessingStagesProps = {
  project: Project;
};

// Этапы обработки и общий прогресс: шаг «Обработка» мастера и экран проекта.
export function ProcessingStages({ project }: ProcessingStagesProps): JSX.Element {
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
    </Stack>
  );
}

type PollingStalledAlertProps = {
  project: Project;
  onCheckAgain: () => void;
};

// Предохранитель опроса сработал (api.md, «Статус обработки»): текст зависит от этапа.
export function PollingStalledAlert({
  project,
  onCheckAgain,
}: PollingStalledAlertProps): JSX.Element {
  const queued = project.state.kind === 'processing' && project.state.stage === 'queued';
  return (
    <Alert color="ochre" variant="light">
      <Group justify="space-between" gap="md">
        <Text size="sm">
          {queued ? 'Обработка не началась за 30 минут.' : 'Обработка идёт дольше обычного.'}
        </Text>
        <Button variant="default" size="xs" onClick={onCheckAgain}>
          Проверить снова
        </Button>
      </Group>
    </Alert>
  );
}

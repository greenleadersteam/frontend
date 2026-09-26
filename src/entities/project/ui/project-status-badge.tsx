import { Badge } from '@mantine/core';
import type { JSX } from 'react';

import type { StatusVariant } from '@/shared/theme';

import { STAGE_LABELS, STATE_LABELS } from '../config/labels';
import type { ProjectState } from '../model/project';

type ProjectStatusBadgeProps = {
  state: ProjectState;
  // Процент этапа — отдельной капсулой справа. Подробность ошибки в бейдж не попадает:
  // она выводится отдельной строкой рядом (design.md, «Бейдж статуса»).
  progressPct?: number;
};

// Неизвестный статус — скорее всего новый этап обработки, поэтому цвет «идёт обработка».
const VARIANTS: Record<ProjectState['kind'], StatusVariant> = {
  draft: 'draft',
  processing: 'processing',
  unknown: 'processing',
  ready: 'ready',
  failed: 'failed',
};

const percent = new Intl.NumberFormat('ru-RU', { style: 'percent' });

export function ProjectStatusBadge({ state, progressPct }: ProjectStatusBadgeProps): JSX.Element {
  const label = state.kind === 'processing' ? STAGE_LABELS[state.stage] : STATE_LABELS[state.kind];

  return (
    <Badge
      variant={VARIANTS[state.kind]}
      rightSection={progressPct === undefined ? undefined : percent.format(progressPct / 100)}
    >
      {label}
    </Badge>
  );
}

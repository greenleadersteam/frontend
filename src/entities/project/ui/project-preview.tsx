import { useInViewport } from '@mantine/hooks';
import {
  type Icon as TablerIcon,
  IconAlertTriangle,
  IconFileZip,
  IconLoader2,
} from '@tabler/icons-react';
import { type JSX, useState } from 'react';

import { useGetPlantingQuery, useGetZonesQuery } from '../api/project-result-api';
import type { Project } from '../model/project';
import { PlanCanvas } from './plan-canvas';
import classes from './project-preview.module.css';

type ProjectPreviewProps = {
  project: Project;
};

// Размер 32 — по макету экрана «Проекты»: заглушка превью крупнее иконок действий (20–24).
// У готового проекта заглушка появляется, только если план не загрузился, — тихая, как у draft.
const PLACEHOLDER_ICONS: Record<Project['state']['kind'], TablerIcon> = {
  draft: IconFileZip,
  processing: IconLoader2,
  unknown: IconLoader2,
  ready: IconFileZip,
  failed: IconAlertTriangle,
};

// Превью 4:3. У готового проекта — мини-план из его /planting и /zones, у остальных —
// заглушка с иконкой. Ошибка загрузки плана даёт тихую заглушку: список не должен пестрить.
export function ProjectPreview({ project }: ProjectPreviewProps): JSX.Element {
  const { ref: rootRef, inViewport } = useInViewport<HTMLDivElement>();

  // Данные запрашиваются только после первого появления карточки в области видимости.
  const [seen, setSeen] = useState(false);
  if (inViewport && !seen) setSeen(true);

  const ready = project.state.kind === 'ready';
  const skip = !ready || !seen;
  const planting = useGetPlantingQuery(project.id, { skip });
  const zones = useGetZonesQuery(project.id, { skip });
  const plantingData = planting.data;
  const zonesData = zones.data;

  const failed = planting.isError || zones.isError;
  const PlaceholderIcon = PLACEHOLDER_ICONS[project.state.kind];

  return (
    <div ref={rootRef} className={classes.root}>
      {ready && plantingData !== undefined && zonesData !== undefined && !failed ? (
        <PlanCanvas planting={plantingData} zones={zonesData} />
      ) : (
        (!ready || failed) && (
          <PlaceholderIcon
            size={32}
            stroke={1.5}
            aria-hidden
            className={classes.icon}
            data-error={project.state.kind === 'failed' ? true : undefined}
          />
        )
      )}
    </div>
  );
}

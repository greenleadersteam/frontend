import { ActionIcon, Card, Menu, Text } from '@mantine/core';
import { IconDots } from '@tabler/icons-react';
import { type JSX, useId, useState } from 'react';
import { Link } from 'react-router';

import {
  getProcessingDurationMs,
  isProcessing,
  JOB_ERROR_LABELS,
  type Project,
  ProjectPreview,
  ProjectStatusBadge,
} from '@/entities/project';
import { projectPath, projectUploadPath } from '@/shared/config';
import { formatDate, formatDuration } from '@/shared/lib/format';
import { Icon } from '@/shared/ui';

import { DeleteProjectModal, PROCESSING_HANG_MINUTES } from './delete-project-modal';
import classes from './project-card.module.css';

type ProjectCardProps = {
  project: Project;
  // Предохранитель опроса списка сработал: проект с зависшей обработкой можно удалить.
  stalled: boolean;
  // Когда список получен (Date.now() ответа): от него считается длительность обработки.
  checkedAt: number;
  // Карточка исчезает после удаления, поэтому фокус переводит список.
  onDeleted: () => void;
};

// Карточка — article, а не ссылка: внутри есть вторая интерактивная кнопка (меню),
// а вложенные интерактивные элементы запрещены. Переход по всей площади даёт «растянутая
// ссылка» на названии: её ::after покрывает карточку, кнопка меню лежит поверх.
export function ProjectCard({
  project,
  stalled,
  checkedAt,
  onDeleted,
}: ProjectCardProps): JSX.Element {
  const [deleteOpened, setDeleteOpened] = useState(false);
  const hintId = useId();
  const { state, job } = project;
  const processing = isProcessing(state);
  // Бэкенд удаляет проект в любом статусе: ../backend/greenplan/api/app.py:87-94.
  // Предохранитель один на весь список, поэтому удаление открывается только у тех проектов,
  // чья обработка к моменту последнего ответа шла дольше 30 минут. Сравниваются часы сервера
  // и клиента: расхождение в минуты на таком пороге не важно.
  const hangs =
    stalled &&
    job.started_at != null &&
    checkedAt - Date.parse(job.started_at) >= PROCESSING_HANG_MINUTES * 60 * 1000;
  const deleteLocked = processing && !hangs;
  // Архив можно загрузить без архива и после ошибки. При ambiguous_root_dxf вместо нового
  // архива предлагается выбор главного DXF — тот же мастер, сразу на шаге выбора.
  const chooseRoot = state.kind === 'failed' && state.error?.code === 'ambiguous_root_dxf';
  const canUpload = state.kind === 'draft' || (state.kind === 'failed' && !chooseRoot);
  const duration = state.kind === 'ready' ? getProcessingDurationMs(job) : null;

  return (
    <Card component="article" padding={0} className={classes.card}>
      <div className={classes.preview}>
        <ProjectPreview project={project} />
        <Menu position="bottom-end">
          <Menu.Target>
            <ActionIcon
              variant="default"
              size="lg"
              aria-label="Действия с проектом"
              className={classes.menuButton}
            >
              <Icon icon={IconDots} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {canUpload && (
              <Menu.Item component={Link} to={projectUploadPath(project.id)}>
                Загрузить архив
              </Menu.Item>
            )}
            {chooseRoot && (
              <Menu.Item component={Link} to={projectUploadPath(project.id)}>
                Выбрать главный чертёж
              </Menu.Item>
            )}
            <Menu.Item
              disabled={deleteLocked}
              aria-describedby={deleteLocked ? hintId : undefined}
              onClick={() => {
                setDeleteOpened(true);
              }}
            >
              Удалить проект
            </Menu.Item>
            {deleteLocked && (
              <Text id={hintId} size="xs" c="dimmed" className={classes.menuHint}>
                Удалить можно после завершения обработки
              </Text>
            )}
          </Menu.Dropdown>
        </Menu>
      </div>

      <div className={classes.body}>
        <div className={classes.status}>
          <ProjectStatusBadge
            state={state}
            progressPct={processing ? job.progress_pct : undefined}
          />
          {duration !== null && (
            <Text size="sm" c="dimmed" className={classes.duration}>
              {`за ${formatDuration(duration)}`}
            </Text>
          )}
        </div>

        <Text component="h2" lineClamp={2} className={classes.title}>
          <Link to={projectPath(project.id)} className={classes.link}>
            {project.name}
          </Link>
        </Text>

        {state.kind === 'failed' ? (
          // Без обрезки: вторая половина — что делать (copy.md), её нельзя терять.
          <Text size="sm" className={classes.error}>
            {JOB_ERROR_LABELS[state.error?.code ?? 'other']}
          </Text>
        ) : (
          project.description !== null && (
            <Text size="sm" c="dimmed" lineClamp={2}>
              {project.description}
            </Text>
          )
        )}

        <Text size="xs" c="dimmed">{`изменён ${formatDate(project.updated_at)}`}</Text>
      </div>

      <DeleteProjectModal
        project={project}
        opened={deleteOpened}
        onClose={() => {
          setDeleteOpened(false);
        }}
        hang={
          processing && hangs
            ? state.kind === 'processing' && state.stage === 'queued'
              ? 'queued'
              : 'processing'
            : null
        }
        onDeleted={onDeleted}
      />
    </Card>
  );
}

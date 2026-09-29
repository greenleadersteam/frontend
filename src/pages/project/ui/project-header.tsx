import { ActionIcon, Button, Group, Menu, Popover, Stack, Table, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconDots } from '@tabler/icons-react';
import { type JSX, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import {
  archiveAction,
  downloadProjectDxf,
  GEOREFERENCE_CONFIDENCE_LABELS,
  getProcessingDurationMs,
  isProcessing,
  type Project,
  ProjectStatusBadge,
  resultExtent,
  SERVICE_VERSION,
} from '@/entities/project';
import { deleteAvailability, DeleteProjectModal } from '@/features/delete-project';
import { EditModeButton, VersionSelect } from '@/features/edit-plantings';
import {
  FOCUS_PROJECTS_HEADING,
  georeferenceProjectPath,
  paths,
  projectReportPath,
  projectUploadPath,
  useCapability,
} from '@/shared/config';
import { formatCount, formatDuration, formatMeters } from '@/shared/lib/format';
import { Icon } from '@/shared/ui';

import { useResultData } from '../model/result';
import { DownloadDxf } from './download-dxf';
import { serverManualMethod } from './manual-georeference';
import classes from './project-header.module.css';

type ProjectHeaderProps = {
  project: Project;
  polling: { stalled: boolean; checkedAt: number };
};

export function ProjectHeader({ project, polling }: ProjectHeaderProps): JSX.Element {
  const { state, job } = project;
  const duration = state.kind === 'ready' ? getProcessingDurationMs(job) : null;

  return (
    <header className={classes.header}>
      <Button
        component={Link}
        to={paths.projects}
        variant="subtle"
        leftSection={<Icon icon={IconArrowLeft} tone="accent" />}
        className={classes.back}
      >
        Проекты
      </Button>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xl">
        <Stack gap="sm" className={classes.summary}>
          <Title order={1} lineClamp={2}>
            {project.name}
          </Title>
          <Group gap="sm">
            <ProjectStatusBadge
              state={state}
              progressPct={isProcessing(state) ? job.progress_pct : undefined}
            />
            {duration !== null && (
              <Text size="sm" c="dimmed">{`обработано за ${formatDuration(duration)}`}</Text>
            )}
            {state.kind === 'ready' && <GeoreferenceButton project={project} />}
          </Group>
          {state.kind === 'ready' && <VersionSelect projectId={project.id} />}
          {project.description !== null && <Text c="dimmed">{project.description}</Text>}
        </Stack>
        <Group gap="sm" wrap="nowrap">
          {/* Кнопка правки есть, только когда правки загружены и не устарели. */}
          {state.kind === 'ready' && <EditModeSlot project={project} />}
          {state.kind === 'ready' && <DownloadDxf project={project} />}
          <ProjectMenu project={project} polling={polling} />
        </Group>
      </Group>
    </header>
  );
}

type EditModeSlotProps = { project: Project };

// Результат не загрузился или в нём нет ни посадок, ни зон — править нечего: кнопки нет.
// Запросы те же, что у плана, — из кеша RTK Query.
function EditModeSlot({ project }: EditModeSlotProps): JSX.Element | null {
  const result = useResultData(project);
  const nothing =
    result.kind === 'error' ||
    (result.kind === 'ready' && resultExtent(result.result.data) === null);
  return nothing ? null : <EditModeButton projectId={project.id} />;
}

type GeoreferenceButtonProps = { project: Project };

// Список невязок по точкам показывается, пока он читается глазами.
const RESIDUALS_LIST_LIMIT = 20;
// Порог сервера по умолчанию (../backend/greenplan/api/config.py:33); в контуре его меняют
// переменной окружения, а в ответе API его нет.
const RESIDUAL_LIMIT_M = 1;
const POINT_FORMS = { one: 'опорная точка', few: 'опорные точки', many: 'опорных точек' };

// Геопривязка сервера или её отсутствие.
function GeoreferenceButton({ project }: GeoreferenceButtonProps): JSX.Element {
  const georeference = project.job.georeference ?? null;
  const [opened, setOpened] = useState(false);
  const confidence =
    georeference === null ? null : GEOREFERENCE_CONFIDENCE_LABELS[georeference.confidence];
  const residuals = Object.entries(georeference?.residuals_m ?? {});
  const values = residuals.map(([, value]) => value);
  // Привязка из модуля, применённая сервером: геодезических пунктов у неё нет.
  const serverManual = georeference?.confidence === 'manual';

  return (
    <Popover position="bottom-start" shadow="md" opened={opened} onChange={setOpened} returnFocus>
      <Popover.Target>
        <Button
          variant="subtle"
          size="compact-sm"
          onClick={() => {
            setOpened(!opened);
          }}
        >
          {georeference === null
            ? 'Без геопривязки'
            : `Геопривязка: ${serverManual ? serverManualMethod(values) : (confidence ?? 'есть')}`}
        </Button>
      </Popover.Target>
      <Popover.Dropdown className={classes.georeference}>
        {georeference === null ? (
          <Text size="sm">
            Чертёж не привязан к городу: план показан в координатах чертежа, без подложки.
            Расстояния на плане — в метрах чертежа.
          </Text>
        ) : (
          <Stack gap="xs">
            {serverManual ? (
              <Text size="sm">
                Привязка задана в модуле геопривязки и применена сервером: она кладёт план на карту
                города, а слой DXF — в координатах чертежа. Опорную точку, поворот и масштаб сервер
                не возвращает, поэтому здесь их нет.
              </Text>
            ) : (
              <Text size="sm" className={classes.numbers}>
                {`Совпало: ${formatCount(georeference.matched_labels.length, POINT_FORMS)}`}
              </Text>
            )}
            {values.length > 0 && (
              <Text size="sm" className={classes.numbers}>
                {`Невязка наибольшая ${formatMeters(Math.max(...values))}, средняя ${formatMeters(values.reduce((sum, value) => sum + value, 0) / values.length)}`}
              </Text>
            )}
            {residuals.length > 0 && residuals.length <= RESIDUALS_LIST_LIMIT && (
              <Table className={classes.numbers}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Опорная точка</Table.Th>
                    <Table.Th>Невязка</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {residuals.map(([label, value]) => (
                    <Table.Tr key={label}>
                      <Table.Td>{label}</Table.Td>
                      <Table.Td>{formatMeters(value)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
            {/* Невязка — остаток подгонки поворота и сдвига по опорным точкам
                (../backend/greenplan/cli.py:45-48). */}
            {!serverManual && (
              <Text size="sm" c="dimmed">
                {`Невязка — расхождение между опорной точкой чертежа после привязки и координатами этого геодезического пункта. При трёх и более точках сервер по умолчанию отклоняет привязку, если невязка больше ${formatMeters(RESIDUAL_LIMIT_M)}; при четырёх и более может отбросить одну точку, и в списке её нет.`}
              </Text>
            )}
            {georeference.confidence === 'unvalidated' && (
              <Text size="sm" c="dimmed">
                По двум точкам привязка строится без запаса, поэтому невязки её не подтверждают.
              </Text>
            )}
          </Stack>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}

type ProjectMenuProps = ProjectHeaderProps;

function ProjectMenu({ project, polling }: ProjectMenuProps): JSX.Element {
  const [deleteOpened, setDeleteOpened] = useState(false);
  const hintId = useId();
  const navigate = useNavigate();
  const archive = archiveAction(project.state);
  const deletion = deleteAvailability(project, polling);
  const withEditedDxf = useCapability('editedDxf');
  // Привязать проект к карте из модуля может только сервер (следующая версия; в «Демо» — как цель).
  const bindable = useCapability('manualGeoreference');
  const ready = project.state.kind === 'ready';

  // Пока файл скачивается, пункт недоступен: второй щелчок скачал бы его ещё раз.
  const [downloading, setDownloading] = useState(false);
  const downloadOriginal = async () => {
    setDownloading(true);
    const failure = await downloadProjectDxf(project, {
      version: SERVICE_VERSION,
      fileSuffix: ' — исходный результат.dxf',
    });
    setDownloading(false);
    if (failure !== null) notifications.show({ color: 'clay', message: failure });
  };

  return (
    <>
      <Menu position="bottom-end">
        <Menu.Target>
          <ActionIcon variant="default" size="lg" aria-label="Действия с проектом">
            <Icon icon={IconDots} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          {/* Выбор главного чертежа стоит на самом экране: пункт, уводящий в мастер, не нужен. */}
          {archive === 'upload' && (
            <Menu.Item component={Link} to={projectUploadPath(project.id)}>
              Загрузить архив
            </Menu.Item>
          )}
          {ready && (
            <Menu.Item component={Link} to={projectReportPath(project.id)}>
              Отчёт для согласования
            </Menu.Item>
          )}
          {/* План в координатах чертежа: его можно положить на карту города. */}
          {ready && bindable && project.job.georeference == null && (
            <Menu.Item component={Link} to={georeferenceProjectPath(project.id)}>
              Привязать к карте
            </Menu.Item>
          )}
          {/* С editedDxf «Скачать DXF» отдаёт результат с правками, исходный — отсюда. */}
          {ready && withEditedDxf && (
            <Menu.Item disabled={downloading} onClick={() => void downloadOriginal()}>
              Скачать исходный результат
            </Menu.Item>
          )}
          <Menu.Item
            disabled={deletion.locked}
            aria-describedby={deletion.locked ? hintId : undefined}
            onClick={() => {
              setDeleteOpened(true);
            }}
          >
            Удалить проект
          </Menu.Item>
          {deletion.locked && (
            <Text id={hintId} size="xs" c="dimmed" className={classes.menuHint}>
              Удалить можно после завершения обработки
            </Text>
          )}
        </Menu.Dropdown>
      </Menu>
      <DeleteProjectModal
        project={project}
        opened={deleteOpened}
        onClose={() => {
          setDeleteOpened(false);
        }}
        hang={deletion.locked ? null : deletion.hang}
        onDeleted={() => {
          void navigate(paths.projects, { replace: true, state: FOCUS_PROJECTS_HEADING });
        }}
      />
    </>
  );
}

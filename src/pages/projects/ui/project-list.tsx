import {
  Alert,
  Button,
  Card,
  Group,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { type JSX, useEffect, useRef } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';

import { useProjectsWithPolling } from '@/entities/project';
import { describeAppError, toAppError } from '@/shared/api';
import { isFocusProjectsHeading, paths } from '@/shared/config';
import { formatCount, formatNumber } from '@/shared/lib/format';
import { EmptyState, Icon } from '@/shared/ui';

import {
  DEFAULT_FILTERS,
  type ProjectFilters,
  type ProjectSort,
  readFilters,
  SORTS,
  STATE_GROUPS,
  stateCounts,
  type StateGroup,
  visibleProjects,
  writeFilters,
} from '../model/filters';
import { ProjectCard } from './project-card';
import classes from './project-list.module.css';

const PROJECT_FORMS = { one: 'проект', few: 'проекта', many: 'проектов' };
const SKELETON_IDS = ['a', 'b', 'c', 'd', 'e', 'f'];

const GROUP_LABELS = {
  all: 'Все',
  ready: 'Готово',
  processing: 'Обработка',
  failed: 'Ошибка',
  draft: 'Без архива',
} satisfies Record<StateGroup, string>;

const SORT_LABELS = {
  updated: 'Сначала недавние',
  name: 'По названию',
  problems: 'Сначала проблемные',
} satisfies Record<ProjectSort, string>;

function ProjectCardSkeleton(): JSX.Element {
  return (
    <Card padding={0}>
      <Skeleton className={classes.skeletonPreview} />
      <Stack gap="sm" className={classes.skeletonBody}>
        <Skeleton height="1.5rem" width="45%" radius="xl" />
        <Skeleton height="1rem" width="80%" />
        <Skeleton height="0.75rem" width="35%" />
      </Stack>
    </Card>
  );
}

export function ProjectList(): JSX.Element {
  const {
    data: projects,
    error,
    isFetching,
    fulfilledTimeStamp,
    refetch,
    pollingStalled,
    checkAgain,
  } = useProjectsWithPolling();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const navigationState: unknown = useLocation().state;
  // Фильтр живёт в адресе: ссылкой можно поделиться, «Назад» возвращает прежний фильтр.
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readFilters(searchParams);
  const changeFilters = (change: Partial<ProjectFilters>, replace = false) => {
    setSearchParams((params) => writeFilters(params, { ...filters, ...change }), { replace });
  };

  // Проект удалён с его экрана: фокус с исчезнувшей кнопки переходит на заголовок списка.
  useEffect(() => {
    if (isFocusProjectsHeading(navigationState)) headingRef.current?.focus();
  }, [navigationState]);
  const counts = stateCounts(projects ?? []);
  const shown = projects === undefined ? [] : visibleProjects(projects, filters);
  // «Без архива» — только когда такие проекты есть или фильтр уже на них.
  const groups = STATE_GROUPS.filter(
    (group) => group !== 'draft' || counts.draft > 0 || filters.state === 'draft',
  );

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="flex-start">
        <Stack gap="xs">
          <Title order={1} ref={headingRef} tabIndex={-1} className={classes.heading}>
            Проекты
          </Title>
          {projects !== undefined && (
            <Text c="dimmed">{formatCount(projects.length, PROJECT_FORMS)}</Text>
          )}
        </Stack>
        {/* Главное действие одно на экран: в пустом состоянии его несёт EmptyState. */}
        {projects?.length !== 0 && (
          <Button component={Link} to={paths.projectNew}>
            Загрузить проект
          </Button>
        )}
      </Group>

      {/* error сбрасывается только успешным ответом, поэтому на время повторных запросов
          предупреждение не пропадает и не мигает. */}
      {projects !== undefined && error !== undefined && (
        <Alert color="ochre" variant="light">
          <Group justify="space-between" gap="md">
            <Text size="sm">Не удалось обновить статусы. Проверьте связь с сервером.</Text>
            <Button variant="default" size="xs" loading={isFetching} onClick={() => void refetch()}>
              Повторить
            </Button>
          </Group>
        </Alert>
      )}

      {pollingStalled && (
        <Alert color="ochre" variant="light">
          <Group justify="space-between" gap="md">
            <Text size="sm">Обработка идёт дольше обычного. Статусы могли устареть.</Text>
            <Button variant="default" size="xs" onClick={checkAgain}>
              Проверить снова
            </Button>
          </Group>
        </Alert>
      )}

      {projects === undefined ? (
        error !== undefined && !isFetching ? (
          <Stack gap="md" align="flex-start">
            <Text>{describeAppError(toAppError(error))}</Text>
            <Button variant="default" onClick={() => void refetch()}>
              Повторить
            </Button>
          </Stack>
        ) : (
          <div
            className={classes.grid}
            role="status"
            aria-busy="true"
            aria-label="Загрузка проектов"
          >
            {SKELETON_IDS.map((id) => (
              <ProjectCardSkeleton key={id} />
            ))}
          </div>
        )
      ) : projects.length === 0 ? (
        <EmptyState
          title="Проектов пока нет"
          description="Загрузите архив с подосновой и сетями — сервис предложит план посадок с обоснованием по нормам."
          action={
            <Button component={Link} to={paths.projectNew}>
              Загрузить проект
            </Button>
          }
        />
      ) : (
        <Stack gap="lg">
          <Group gap="md" align="flex-end" className={classes.filters}>
            <TextInput
              aria-label="Поиск по названию"
              placeholder="Название проекта"
              leftSection={<Icon icon={IconSearch} />}
              value={filters.query}
              onChange={(event) => {
                // Набор не копит историю: «Назад» возвращает к прежнему фильтру, а не к букве.
                changeFilters({ query: event.currentTarget.value }, true);
              }}
              className={classes.search}
            />
            <SegmentedControl
              aria-label="Состояние обработки"
              value={filters.state}
              onChange={(value) => {
                const group = STATE_GROUPS.find((candidate) => candidate === value);
                if (group !== undefined) changeFilters({ state: group });
              }}
              data={groups.map((group) => ({
                value: group,
                label: (
                  <span className={classes.segment}>
                    {`${GROUP_LABELS[group]} `}
                    <span className={classes.segmentCount}>{formatNumber(counts[group])}</span>
                  </span>
                ),
              }))}
            />
            <Select
              aria-label="Сортировка"
              className={classes.sort}
              data={SORTS.map((sort) => ({ value: sort, label: SORT_LABELS[sort] }))}
              value={filters.sort}
              allowDeselect={false}
              onChange={(value) => {
                const sort = SORTS.find((candidate) => candidate === value);
                if (sort !== undefined) changeFilters({ sort });
              }}
            />
          </Group>
          {shown.length === 0 ? (
            <EmptyState
              title="Ничего не нашлось"
              description="Ни один проект не подходит под поиск и фильтр."
              action={
                <Button
                  variant="default"
                  onClick={() => {
                    changeFilters(DEFAULT_FILTERS);
                  }}
                >
                  Сбросить фильтры
                </Button>
              }
            />
          ) : (
            <div className={classes.grid}>
              {shown.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  stalled={pollingStalled}
                  checkedAt={fulfilledTimeStamp ?? 0}
                  onDeleted={() => headingRef.current?.focus()}
                />
              ))}
            </div>
          )}
        </Stack>
      )}
    </Stack>
  );
}

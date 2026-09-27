import {
  Button,
  Card,
  Group,
  Pagination,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowUp,
  IconCircleCheck,
  IconCircleX,
  IconSelector,
} from '@tabler/icons-react';
import { type JSX, useState } from 'react';

import {
  type ExplanationEntry,
  PLANT_TYPE_LABELS,
  type PlantingStatus,
  type PreparedZones,
  prohibitedArea,
  type Project,
  projectFileName,
  type RejectedSitesFeatureCollection,
  RESULT_COUNT_FORMS,
} from '@/entities/project';
import type { EditCounts, FinalPlanting } from '@/features/edit-plantings';
import {
  formatCoordinate,
  formatCount,
  formatDrawingCoordinate,
  formatNumber,
  formatSquareMeters,
} from '@/shared/lib/format';
import { saveFile } from '@/shared/lib/save-file';
import { Icon } from '@/shared/ui';

import classes from './planting-register.module.css';
import {
  registerCsv,
  type RegisterRow,
  registerRows,
  SOURCE_LABELS,
  STATUS_LABELS,
} from './register-csv';
import { RejectedTable } from './rejected-table';
import type { CenterRequest } from './result-map';

type PlantingRegisterProps = {
  project: Project;
  // Итоговая расстановка: расстановка сервиса с правками.
  planting: FinalPlanting;
  statuses: ReadonlyMap<string, PlantingStatus>;
  counts: EditCounts;
  explanation: ReadonlyMap<string, ExplanationEntry>;
  prepared: PreparedZones;
  geographic: boolean;
  // Отклонённые места (возможность rejected); null — сервер их не отдаёт, переключателя нет.
  rejected: RejectedSitesFeatureCollection | null;
  // Показать посадку или место на плане; null — плана с выбором нет (карта недоступна).
  onOpen: ((target: CenterRequest['target']) => void) | null;
};

const LISTS = [
  { value: 'plantings', label: 'Посадки' },
  { value: 'rejected', label: 'Отклонённые' },
];

const PAGE_SIZE = 50;

type TypeFilter = 'all' | 'tree' | 'shrub';
const TYPE_FILTERS = [
  { value: 'all', label: 'Все' },
  { value: 'tree', label: 'Деревья' },
  { value: 'shrub', label: 'Кустарники' },
];
const parseTypeFilter = (value: string): TypeFilter =>
  value === 'tree' || value === 'shrub' ? value : 'all';

type SortColumn = 'number' | 'type' | 'rule';
type Sort = { column: SortColumn; direction: 'ascending' | 'descending' };

const collator = new Intl.Collator('ru-RU', { numeric: true });

const compareBy: Record<SortColumn, (a: RegisterRow, b: RegisterRow) => number> = {
  number: (a, b) => a.number - b.number,
  type: (a, b) => collator.compare(PLANT_TYPE_LABELS[a.plantType], PLANT_TYPE_LABELS[b.plantType]),
  rule: (a, b) => collator.compare(a.ruleName ?? '', b.ruleName ?? ''),
};

const ZONES_FOR = { tree: 'Для деревьев', shrub: 'Для кустарников' } as const;

const STATUS_ICONS = {
  allowed: { icon: IconCircleCheck, tone: 'accent' },
  forbidden: { icon: IconCircleX, tone: 'error' },
  rejected: { icon: IconAlertTriangle, tone: 'error' },
} as const;

// «Правок: 5 (перемещено 3, добавлено 1, удалено 1)» — разбивка только по ненулевым видам.
function editsLine({ total, moved, added, removed, species }: EditCounts): string {
  const parts = [
    ...(moved > 0 ? [`перемещено ${formatNumber(moved)}`] : []),
    ...(added > 0 ? [`добавлено ${formatNumber(added)}`] : []),
    ...(removed > 0 ? [`удалено ${formatNumber(removed)}`] : []),
    ...(species > 0 ? [`сменена порода ${formatNumber(species)}`] : []),
  ];
  return `Правок: ${formatNumber(total)} (${parts.join(', ')})`;
}

export function PlantingRegister({
  project,
  planting,
  statuses,
  counts,
  explanation,
  prepared,
  geographic,
  rejected,
  onOpen,
}: PlantingRegisterProps): JSX.Element {
  const [list, setList] = useState<'plantings' | 'rejected'>('plantings');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [rule, setRule] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>({ column: 'number', direction: 'ascending' });
  const [page, setPage] = useState(1);
  // Перемещённые, добавленные и со сменённой породой.
  const [onlyChanged, setOnlyChanged] = useState(false);
  const edited = counts.total > 0;

  const rows = registerRows(planting, explanation, geographic, statuses);
  const withGeo = rows.some(({ lat }) => lat !== null);
  const withDrawing = rows.some(({ x }) => x !== null);
  const ruleCounts = countBy(rows.flatMap(({ ruleName }) => (ruleName === null ? [] : [ruleName])));
  const typeCounts = countBy(rows.map(({ plantType }) => plantType));

  const query = search.trim().toLocaleLowerCase('ru-RU');
  const filtered = rows
    .filter(
      (row) =>
        (typeFilter === 'all' || row.plantType === typeFilter) &&
        (rule === null || row.ruleName === rule) &&
        (!onlyChanged || row.changed) &&
        row.id.toLocaleLowerCase('ru-RU').includes(query),
    )
    .sort((a, b) => {
      const order = compareBy[sort.column](a, b) || a.number - b.number;
      return sort.direction === 'ascending' ? order : -order;
    });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const shown = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const resetPage = () => {
    setPage(1);
  };
  const resetFilters = () => {
    setTypeFilter('all');
    setRule(null);
    setSearch('');
    setOnlyChanged(false);
    resetPage();
  };
  const toggleSort = (column: SortColumn) => {
    setSort((previous) => ({
      column,
      direction:
        previous.column === column && previous.direction === 'ascending'
          ? 'descending'
          : 'ascending',
    }));
    resetPage();
  };
  const download = () => {
    saveFile(
      new Blob([registerCsv(rows, edited)], { type: 'text/csv;charset=utf-8' }),
      projectFileName(project.name, ' — ведомость посадок.csv'),
    );
  };

  const zoneLines = (['tree', 'shrub'] as const).flatMap((plantType) => {
    const count = prepared.zones.filter(
      ({ properties }) => properties.plant_type === plantType,
    ).length;
    return count === 0
      ? []
      : [
          {
            plantType,
            text: `${ZONES_FOR[plantType]}: ${formatCount(count, RESULT_COUNT_FORMS.zones)}, общая площадь ${formatSquareMeters(prohibitedArea(prepared, plantType))}`,
          },
        ];
  });

  const sortHeader = (column: SortColumn, label: string) => {
    const active = sort.column === column;
    return (
      <Table.Th aria-sort={active ? sort.direction : undefined}>
        <UnstyledButton
          className={classes.sort}
          onClick={() => {
            toggleSort(column);
          }}
        >
          {label}
          <Icon
            icon={
              !active ? IconSelector : sort.direction === 'ascending' ? IconArrowUp : IconArrowDown
            }
          />
        </UnstyledButton>
      </Table.Th>
    );
  };

  return (
    <Stack gap="lg">
      <Card>
        <Group justify="space-between" align="flex-start" gap="xl">
          <Stack gap="xs">
            <Title order={2} className={classes.title}>
              Сводка
            </Title>
            <ul className={classes.summary}>
              <li
                className={classes.numbers}
              >{`Деревья — ${formatNumber(typeCounts.get('tree') ?? 0)}`}</li>
              <li
                className={classes.numbers}
              >{`Кустарники — ${formatNumber(typeCounts.get('shrub') ?? 0)}`}</li>
              {[...ruleCounts].map(([name, count]) => (
                <li key={name} className={classes.numbers}>
                  {`${name} — ${formatNumber(count)}`}
                </li>
              ))}
              {zoneLines.map(({ plantType, text }) => (
                <li key={plantType} className={classes.numbers}>
                  {text}
                </li>
              ))}
              {edited && <li className={classes.numbers}>{editsLine(counts)}</li>}
            </ul>
          </Stack>
          <Button variant="default" onClick={download}>
            Скачать ведомость (CSV)
          </Button>
        </Group>
      </Card>

      <Card>
        <Stack gap="md">
          {rejected !== null && (
            <SegmentedControl
              data={LISTS}
              value={list}
              onChange={(value) => {
                setList(value === 'rejected' ? 'rejected' : 'plantings');
              }}
              aria-label="Список ведомости"
              className={classes.list}
            />
          )}
          {list === 'rejected' && rejected !== null ? (
            <RejectedTable
              rejected={rejected}
              geographic={geographic}
              onOpen={
                onOpen === null
                  ? null
                  : (index) => {
                      onOpen({ kind: 'rejected', index });
                    }
              }
            />
          ) : (
            <>
              <Group gap="md" align="flex-end">
                <SegmentedControl
                  data={TYPE_FILTERS}
                  value={typeFilter}
                  onChange={(value) => {
                    setTypeFilter(parseTypeFilter(value));
                    resetPage();
                  }}
                  aria-label="Тип посадки"
                />
                <Select
                  label="Правило посадки"
                  placeholder="Все правила"
                  data={[...ruleCounts.keys()]}
                  value={rule}
                  onChange={(value) => {
                    setRule(value);
                    resetPage();
                  }}
                  clearable
                  className={classes.filter}
                />
                <TextInput
                  label="Идентификатор"
                  placeholder="Часть идентификатора"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.currentTarget.value);
                    resetPage();
                  }}
                  className={classes.filter}
                />
                {edited && (
                  <Switch
                    label="Только изменённые"
                    checked={onlyChanged}
                    onChange={(event) => {
                      setOnlyChanged(event.currentTarget.checked);
                      resetPage();
                    }}
                  />
                )}
              </Group>

              {filtered.length === 0 ? (
                <Stack gap="xs" align="flex-start">
                  <Text>Нет посадок по выбранным условиям</Text>
                  <Button variant="subtle" onClick={resetFilters}>
                    Сбросить фильтры
                  </Button>
                </Stack>
              ) : (
                <>
                  <Table.ScrollContainer minWidth={0}>
                    <Table highlightOnHover>
                      <Table.Thead>
                        <Table.Tr>
                          {sortHeader('number', '№')}
                          <Table.Th>Идентификатор</Table.Th>
                          {sortHeader('type', 'Тип')}
                          {sortHeader('rule', 'Правило посадки')}
                          {edited && (
                            <>
                              <Table.Th>Статус</Table.Th>
                              <Table.Th>Источник</Table.Th>
                            </>
                          )}
                          {withGeo && (
                            <>
                              <Table.Th>Широта</Table.Th>
                              <Table.Th>Долгота</Table.Th>
                            </>
                          )}
                          {withDrawing && (
                            <>
                              <Table.Th>X чертежа, м</Table.Th>
                              <Table.Th>Y чертежа, м</Table.Th>
                            </>
                          )}
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {shown.map((row) => (
                          <Table.Tr
                            key={row.id}
                            className={onOpen === null ? undefined : classes.row}
                          >
                            <Table.Td className={classes.numbers}>{row.number}</Table.Td>
                            <Table.Td>
                              {/* Кнопка растянута на всю строку: щелчок по строке и Enter на ней
                              показывают посадку на плане. Строка — не ссылка: вид плана
                              меняет состояние экрана, а не адрес. */}
                              {onOpen === null ? (
                                row.id
                              ) : (
                                <UnstyledButton
                                  className={classes.open}
                                  aria-label={`Показать на плане: ${row.id}`}
                                  onClick={() => {
                                    onOpen({ kind: 'planting', id: row.id });
                                  }}
                                >
                                  {row.id}
                                </UnstyledButton>
                              )}
                            </Table.Td>
                            <Table.Td>{PLANT_TYPE_LABELS[row.plantType]}</Table.Td>
                            <Table.Td>{row.ruleName ?? '—'}</Table.Td>
                            {edited && (
                              <>
                                <Table.Td>
                                  <Group gap="xs" wrap="nowrap">
                                    <Icon
                                      icon={STATUS_ICONS[row.status].icon}
                                      tone={STATUS_ICONS[row.status].tone}
                                    />
                                    {STATUS_LABELS[row.status]}
                                  </Group>
                                </Table.Td>
                                <Table.Td>{SOURCE_LABELS[row.source]}</Table.Td>
                              </>
                            )}
                            {withGeo && (
                              <>
                                <Table.Td className={classes.numbers}>
                                  {row.lat === null ? '—' : formatCoordinate(row.lat)}
                                </Table.Td>
                                <Table.Td className={classes.numbers}>
                                  {row.lon === null ? '—' : formatCoordinate(row.lon)}
                                </Table.Td>
                              </>
                            )}
                            {withDrawing && (
                              <>
                                <Table.Td className={classes.numbers}>
                                  {row.x === null ? '—' : formatDrawingCoordinate(row.x)}
                                </Table.Td>
                                <Table.Td className={classes.numbers}>
                                  {row.y === null ? '—' : formatDrawingCoordinate(row.y)}
                                </Table.Td>
                              </>
                            )}
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed" className={classes.numbers}>
                      {`Показано ${formatNumber((currentPage - 1) * PAGE_SIZE + 1)}–${formatNumber((currentPage - 1) * PAGE_SIZE + shown.length)} из ${formatNumber(filtered.length)}`}
                    </Text>
                    {pages > 1 && (
                      <Pagination
                        total={pages}
                        value={currentPage}
                        onChange={setPage}
                        getControlProps={(control) => ({
                          'aria-label':
                            control === 'previous' ? 'Предыдущая страница' : 'Следующая страница',
                        })}
                        getItemProps={(item) => ({ 'aria-label': `Страница ${String(item)}` })}
                      />
                    )}
                  </Group>
                </>
              )}
            </>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}

// Счётчик в порядке первого появления: сводка идёт в порядке ведомости.
function countBy<T>(values: T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

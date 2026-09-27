import { Group, Pagination, Stack, Table, Text, UnstyledButton } from '@mantine/core';
import { type JSX, useState } from 'react';

import {
  obstacleLabel,
  PLANT_TYPE_LABELS,
  type RejectedSitesFeatureCollection,
} from '@/entities/project';
import {
  formatCoordinate,
  formatDrawingCoordinate,
  formatMeters,
  formatNumber,
} from '@/shared/lib/format';

import classes from './planting-register.module.css';

type RejectedTableProps = {
  rejected: RejectedSitesFeatureCollection;
  // Координаты мест — WGS84 у проекта с геопривязкой, иначе метры чертежа.
  geographic: boolean;
  // Показать место на плане; null — плана с выбором нет.
  onOpen: ((index: number) => void) | null;
};

type Site = RejectedSitesFeatureCollection['features'][number];

// Как у ведомости посадок: на крупном участке отклонённых мест тысячи.
const PAGE_SIZE = 50;

// Причина одной строкой — первая непройденная проверка: самая короткая формулировка «почему».
function reasonOf({ properties }: Site): string {
  const [first] = properties.failed_checks;
  if (first === undefined) return '—';
  return `${obstacleLabel(first.category, first.subtype)}: ${formatMeters(first.actual_m, 2)} при норме не менее ${formatMeters(first.required_m)}`;
}

// Отклонённые места рядом с таблицей посадок: где сервис не стал сажать и почему.
export function RejectedTable({ rejected, geographic, onOpen }: RejectedTableProps): JSX.Element {
  const [page, setPage] = useState(1);
  if (rejected.features.length === 0) {
    return <Text>Отклонённых мест нет: правила посадки не упёрлись в нормы</Text>;
  }
  const format = geographic ? formatCoordinate : formatDrawingCoordinate;
  const total = rejected.features.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  const first = (Math.min(page, pages) - 1) * PAGE_SIZE;
  const shown = rejected.features.slice(first, first + PAGE_SIZE);

  return (
    <Stack gap="md">
      <Table.ScrollContainer minWidth={0}>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>№</Table.Th>
              <Table.Th>Тип</Table.Th>
              <Table.Th>Причина</Table.Th>
              <Table.Th>{geographic ? 'Широта' : 'X чертежа, м'}</Table.Th>
              <Table.Th>{geographic ? 'Долгота' : 'Y чертежа, м'}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.map((site, offset) => {
              const index = first + offset;
              const [x = 0, y = 0] = site.geometry.coordinates;
              const number = index + 1;
              return (
                // Номер — позиция в /rejected: у мест нет своего идентификатора.
                <Table.Tr key={index} className={onOpen === null ? undefined : classes.row}>
                  <Table.Td className={classes.numbers}>
                    {onOpen === null ? (
                      number
                    ) : (
                      <UnstyledButton
                        className={classes.open}
                        aria-label={`Показать на плане: отклонённое место ${String(number)}`}
                        onClick={() => {
                          onOpen(index);
                        }}
                      >
                        {number}
                      </UnstyledButton>
                    )}
                  </Table.Td>
                  <Table.Td>{PLANT_TYPE_LABELS[site.properties.plant_type]}</Table.Td>
                  <Table.Td>{reasonOf(site)}</Table.Td>
                  {/* WGS84 — «долгота, широта» в данных, в таблице — широта первой. */}
                  <Table.Td className={classes.numbers}>{format(geographic ? y : x)}</Table.Td>
                  <Table.Td className={classes.numbers}>{format(geographic ? x : y)}</Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Group justify="space-between">
        <Text size="sm" c="dimmed" className={classes.numbers}>
          {`Показано ${formatNumber(first + 1)}–${formatNumber(first + shown.length)} из ${formatNumber(total)}`}
        </Text>
        {pages > 1 && (
          <Pagination
            total={pages}
            value={Math.min(page, pages)}
            onChange={setPage}
            getControlProps={(control) => ({
              'aria-label': control === 'previous' ? 'Предыдущая страница' : 'Следующая страница',
            })}
            getItemProps={(item) => ({ 'aria-label': `Страница ${String(item)}` })}
          />
        )}
      </Group>
    </Stack>
  );
}

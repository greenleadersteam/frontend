import { Table, Text } from '@mantine/core';
import type { JSX } from 'react';

import { PLANT_TYPE_LABELS } from '@/entities/project';
import { formatNumber } from '@/shared/lib/format';

import { NO_SPECIES_NOTE, type SpeciesRow, speciesTotals, TOTAL_LABELS } from './species-register';
import classes from './species-table.module.css';

type SpeciesTableProps = {
  rows: readonly SpeciesRow[];
  // Отчёт: таблица плотнее экрана, заголовки короче, а одинаковое у всех строк примечание —
  // одной сноской под таблицей.
  report?: boolean;
  className?: string;
};

const REPORT_NOTE = `${NO_SPECIES_NOTE} — подбирается при рабочем проектировании`;

// Ведомость озеленения: порода по-русски и по-латыни, тип, количество, примечание и итоги
// по деревьям и кустарникам. Та же таблица — в отчёте для согласования.
export function SpeciesTable({ rows, report = false, className }: SpeciesTableProps): JSX.Element {
  const totals = speciesTotals(rows);
  // В отчёте колонка примечаний — только когда они у строк разные: одинаковое у всех («порода
  // не определена») — сноской под таблицей, пустое у всех — ничем.
  const notes = new Set(rows.map(({ note }) => note));
  const noteColumn = !report || notes.size > 1;
  const footnote = !noteColumn && notes.has(NO_SPECIES_NOTE);
  return (
    <>
      <Table className={className}>
        <Table.Thead className={classes.head}>
          <Table.Tr>
            <Table.Th className={classes.index}>{report ? '№' : '№ п/п'}</Table.Th>
            <Table.Th>Наименование</Table.Th>
            <Table.Th>Тип</Table.Th>
            <Table.Th className={classes.count}>
              {report ? 'Кол-во, шт.' : 'Количество, шт.'}
            </Table.Th>
            {noteColumn && <Table.Th>Примечание</Table.Th>}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row, index) => (
            <Table.Tr
              key={row.key}
              className={classes.row}
              // Кустарники идут после деревьев: граница групп — явной линией, как у итогов.
              data-group-start={
                (index > 0 && rows[index - 1]?.plantType !== row.plantType) || undefined
              }
            >
              <Table.Td className={classes.index}>{formatNumber(index + 1)}</Table.Td>
              <Table.Td>
                <Text>{row.nameRu}</Text>
                {row.nameLat !== null && (
                  <Text size="sm" c="dimmed" fs="italic">
                    {row.nameLat}
                  </Text>
                )}
              </Table.Td>
              <Table.Td>{PLANT_TYPE_LABELS[row.plantType]}</Table.Td>
              <Table.Td className={classes.count}>{formatNumber(row.count)}</Table.Td>
              {noteColumn && <Table.Td>{row.note}</Table.Td>}
            </Table.Tr>
          ))}
        </Table.Tbody>
        <Table.Tfoot className={classes.totals}>
          {(['tree', 'shrub'] as const).map((plantType) => (
            <Table.Tr key={plantType} className={classes.row}>
              <Table.Td />
              <Table.Th scope="row">{TOTAL_LABELS[plantType]}</Table.Th>
              <Table.Td />
              <Table.Td className={classes.count}>{formatNumber(totals[plantType])}</Table.Td>
              {noteColumn && <Table.Td />}
            </Table.Tr>
          ))}
        </Table.Tfoot>
      </Table>
      {footnote && (
        <Text size="sm" c="dimmed">
          {REPORT_NOTE}
        </Text>
      )}
    </>
  );
}

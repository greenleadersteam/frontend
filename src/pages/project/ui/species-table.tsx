import { Table, Text } from '@mantine/core';
import type { JSX } from 'react';

import { PLANT_TYPE_LABELS } from '@/entities/project';
import { formatNumber } from '@/shared/lib/format';

import { type SpeciesRow, speciesTotals, TOTAL_LABELS } from './species-register';
import classes from './species-table.module.css';

type SpeciesTableProps = {
  rows: readonly SpeciesRow[];
  // Отчёт печатает таблицы плотнее экрана.
  className?: string;
};

// Ведомость озеленения: порода по-русски и по-латыни, тип, количество, примечание и итоги
// по деревьям и кустарникам. Та же таблица — в отчёте для согласования.
export function SpeciesTable({ rows, className }: SpeciesTableProps): JSX.Element {
  const totals = speciesTotals(rows);
  return (
    <Table className={className}>
      <Table.Thead className={classes.head}>
        <Table.Tr>
          <Table.Th>№ п/п</Table.Th>
          <Table.Th>Наименование</Table.Th>
          <Table.Th>Тип</Table.Th>
          <Table.Th className={classes.count}>Количество, шт.</Table.Th>
          <Table.Th>Примечание</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row, index) => (
          <Table.Tr key={row.key} className={classes.row}>
            <Table.Td className={classes.numbers}>{formatNumber(index + 1)}</Table.Td>
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
            <Table.Td>{row.note}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
      <Table.Tfoot>
        {(['tree', 'shrub'] as const).map((plantType) => (
          <Table.Tr key={plantType} className={classes.row}>
            <Table.Td />
            <Table.Th scope="row">{TOTAL_LABELS[plantType]}</Table.Th>
            <Table.Td />
            <Table.Td className={classes.count}>{formatNumber(totals[plantType])}</Table.Td>
            <Table.Td />
          </Table.Tr>
        ))}
      </Table.Tfoot>
    </Table>
  );
}

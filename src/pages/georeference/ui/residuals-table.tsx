import { ActionIcon, Checkbox, Table, Tooltip, VisuallyHidden } from '@mantine/core';
import { IconAlertTriangle, IconTrash } from '@tabler/icons-react';
import type { JSX } from 'react';

import { georeferenceActions } from '@/entities/georeference';
import { formatDecimal, type GcpStats, isOutlier } from '@/shared/lib/georeference';
import { useAppDispatch } from '@/shared/lib/store';
import { Icon } from '@/shared/ui';

import classes from './georeference-page.module.css';

type ResidualsTableProps = {
  stats: GcpStats;
  hot: string | null;
  onHot: (id: string | null) => void;
};

const OUTLIER_HINT =
  'Выброс: невязка больше трёх стандартных отклонений, вдвое больше медианной и не меньше пятой ' +
  'части допуска. Проверьте, что точки пары соответствуют друг другу, или выключите точку.';

// Таблица невязок. Сверху — наибольшие по модулю: сомнительные точки видны сразу; невязка выше
// допуска масштаба работ — цветом ошибки и значком. Строка и точка на карте подсвечивают друг
// друга — и мышью, и фокусом с клавиатуры.
export function ResidualsTable({ stats, hot, onHot }: ResidualsTableProps): JSX.Element {
  const dispatch = useAppDispatch();
  const rows = [...stats.rows].sort((a, b) => b.dS - a.dS);

  return (
    <Table className={classes.residuals} striped={false} highlightOnHover={false}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th scope="col">Вкл</Table.Th>
          <Table.Th scope="col">№</Table.Th>
          <Table.Th scope="col">X файла</Table.Th>
          <Table.Th scope="col">Y файла</Table.Th>
          <Table.Th scope="col">X карты (долгота)</Table.Th>
          <Table.Th scope="col">Y карты (широта)</Table.Th>
          <Table.Th scope="col">dN, м</Table.Th>
          <Table.Th scope="col">dE, м</Table.Th>
          <Table.Th scope="col">dS, м</Table.Th>
          <Table.Th scope="col">Контрольная</Table.Th>
          <Table.Th scope="col">
            <VisuallyHidden>Удалить</VisuallyHidden>
          </Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => {
          const { pair } = row;
          const outlier = isOutlier(row, stats);
          const overTolerance = row.dS > stats.tolerance;
          const n = String(pair.n);
          // Строка всегда в Tooltip, выключенном у обычных: иначе при смене статуса «выброс»
          // React пересоздал бы строку, и фокус с флажка ушёл бы на body.
          return (
            <Tooltip
              key={pair.id}
              label={OUTLIER_HINT}
              disabled={!outlier}
              multiline
              position="top-start"
              classNames={{ tooltip: classes.outlierHint }}
            >
              <Table.Tr
                className={classes.residualRow}
                data-hot={hot === pair.id || undefined}
                data-outlier={outlier || undefined}
                data-off={!pair.enabled || undefined}
                onMouseEnter={() => {
                  onHot(pair.id);
                }}
                onMouseLeave={() => {
                  onHot(null);
                }}
                onFocus={() => {
                  onHot(pair.id);
                }}
                onBlur={() => {
                  onHot(null);
                }}
              >
                <Table.Td>
                  <Checkbox
                    aria-label={`Учитывать точку ${n}`}
                    checked={pair.enabled}
                    onChange={(event) =>
                      dispatch(
                        georeferenceActions.gcpChanged({
                          id: pair.id,
                          enabled: event.currentTarget.checked,
                        }),
                      )
                    }
                  />
                </Table.Td>
                <Table.Td>{outlier ? `${n}, выброс` : n}</Table.Td>
                <Table.Td>{formatDecimal(pair.x, 2)}</Table.Td>
                <Table.Td>{formatDecimal(pair.y, 2)}</Table.Td>
                <Table.Td>{formatDecimal(pair.lon, 6)}</Table.Td>
                <Table.Td>{formatDecimal(pair.lat, 6)}</Table.Td>
                <Table.Td>{formatDecimal(row.dN, 3)}</Table.Td>
                <Table.Td>{formatDecimal(row.dE, 3)}</Table.Td>
                <Table.Td className={classes.residualDs} data-over={overTolerance || undefined}>
                  {formatDecimal(row.dS, 3)}
                  {overTolerance && (
                    <Icon icon={IconAlertTriangle} tone="error" label="выше допуска" />
                  )}
                </Table.Td>
                <Table.Td>
                  <Checkbox
                    aria-label={`Контрольная точка ${n}`}
                    checked={pair.control}
                    onChange={(event) =>
                      dispatch(
                        georeferenceActions.gcpChanged({
                          id: pair.id,
                          control: event.currentTarget.checked,
                        }),
                      )
                    }
                  />
                </Table.Td>
                <Table.Td>
                  <ActionIcon
                    variant="subtle"
                    aria-label={`Удалить опорную точку ${n}`}
                    onClick={() => dispatch(georeferenceActions.gcpRemoved({ id: pair.id }))}
                  >
                    <Icon icon={IconTrash} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            </Tooltip>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}

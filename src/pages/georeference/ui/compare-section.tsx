import { Stack, Text, Title } from '@mantine/core';
import type { JSX } from 'react';

import type { StoredReference } from '@/entities/georeference';
import {
  compare,
  formatDecimal,
  formatDegrees,
  formatLength,
  type Placement,
  spread,
} from '@/shared/lib/georeference';

import { formatCreated, formatRelative } from '../lib/compare-format';
import { Readout } from './readout';
import { ReferenceSymbol } from './reference-symbol';

type CompareSectionProps = {
  placement: Placement | null;
  references: readonly StoredReference[];
};

// Сравнение с эталонами. Направление одно для всех строк — текущая привязка относительно
// эталона: поворот со знаком по кратчайшей дуге, масштаб — относительная разница, сдвиг без знака.
// Три знака: на площадке 300 м сотые доли градуса — уже десятки сантиметров на краю контура.
export function CompareSection({ placement, references }: CompareSectionProps): JSX.Element | null {
  if (references.length === 0) return null;

  const bindings = [
    ...references.map(({ anchor, rotation }) => ({ anchor, rotation })),
    ...(placement === null ? [] : [{ anchor: placement.anchor, rotation: placement.rotation }]),
  ];
  const all = spread(bindings);

  return (
    <Stack gap="sm">
      <Title order={3} size="h5">
        Сравнение с эталонами
      </Title>
      {placement === null && (
        <Text size="sm" c="dimmed">
          Текущая привязка не задана: загрузите контур, чтобы увидеть расхождение с эталонами.
        </Text>
      )}
      {references.map((reference) => {
        const difference = placement === null ? null : compare(placement, reference);
        return (
          <Stack key={reference.id} gap="xs">
            <div>
              <Text size="sm" fw={600}>
                <ReferenceSymbol reference={reference} />
                {reference.name}
              </Text>
              <Text size="xs" c="dimmed">
                {`Привязан ${formatCreated(reference.created)}`}
              </Text>
            </div>
            {difference !== null && (
              <Readout
                rows={[
                  ['Сдвиг опорной точки', formatLength(difference.shift, 3)],
                  ['Разница поворота', formatDegrees(difference.rotation, 3)],
                  ['Разница масштаба', formatRelative(difference.scaleRel)],
                ]}
              />
            )}
          </Stack>
        );
      })}
      {references.length > 1 && (
        <Stack gap="xs">
          <Readout
            rows={[
              ['Разброс по положению', formatLength(all.shift, 3)],
              ['Разброс по повороту', formatDegrees(all.rotation, 3)],
            ]}
          />
          <Text size="xs" c="dimmed">
            {`Наибольшее попарное расхождение между ${formatDecimal(all.count)} привязками${placement === null ? '' : ', включая текущую'}.`}
          </Text>
        </Stack>
      )}
    </Stack>
  );
}

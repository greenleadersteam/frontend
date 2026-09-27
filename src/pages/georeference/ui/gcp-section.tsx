import { Alert, Badge, Button, Group, Select, Stack, Text, Title } from '@mantine/core';
import type { JSX } from 'react';

import { georeferenceActions, type Handoff } from '@/entities/georeference';
import {
  formatDecimal,
  formatDegrees,
  formatLength,
  type GcpStats,
  SNAP_PX,
  TOLERANCE_MM,
  type Verdict,
  WORK_SCALES,
  type WorkScale,
} from '@/shared/lib/georeference';
import { useAppDispatch } from '@/shared/lib/store';
import type { StatusVariant } from '@/shared/theme';

import { Readout } from './readout';

// Светофор — бейдж статуса по design.md: без точек, цвет несёт фон.
const VERDICT_BADGE: Record<Exclude<Verdict, 'none'>, { label: string; variant: StatusVariant }> = {
  ok: { label: 'В допуске', variant: 'ready' },
  warn: { label: 'На границе', variant: 'processing' },
  bad: { label: 'Вне допуска', variant: 'failed' },
};

export const VECTOR_SCALES = [0, 10, 50, 100] as const;
export type VectorScale = (typeof VECTOR_SCALES)[number];

type GcpSectionProps = {
  stats: GcpStats | null;
  workScale: WorkScale;
  handoff: Handoff | null;
  locked: boolean;
  active: boolean;
  // Первая точка пары уже поставлена.
  pending: boolean;
  onToggle: () => void;
  vectorScale: VectorScale;
  onVectorScale: (scale: VectorScale) => void;
};

export function GcpSection({
  stats,
  workScale,
  handoff,
  locked,
  active,
  pending,
  onToggle,
  vectorScale,
  onVectorScale,
}: GcpSectionProps): JSX.Element {
  const dispatch = useAppDispatch();

  const counts =
    stats === null
      ? []
      : [
          `${formatDecimal(stats.usedCount)} учтено`,
          ...(stats.controlCount > 0 ? [`${formatDecimal(stats.controlCount)} контрольных`] : []),
          ...(stats.disabledCount > 0 ? [`${formatDecimal(stats.disabledCount)} выключено`] : []),
        ];
  const solved = stats !== null && stats.usedCount >= 2;

  return (
    <Stack gap="sm">
      <Title order={3} size="h5">
        Опорные точки
      </Title>
      {/* Подпись постоянная, состояние передаёт aria-pressed и вариант кнопки. */}
      <Button variant={active ? 'light' : 'default'} aria-pressed={active} onClick={onToggle}>
        Расставить опорные точки
      </Button>
      {active && (
        <Text size="sm" c="dimmed" aria-live="polite">
          {pending
            ? 'Теперь укажите на карте, куда эта точка должна попасть. Esc отменяет незавершённую пару.'
            : `Щёлкните по контуру: точка притянется к вершине, если она ближе ${formatDecimal(SNAP_PX)} пикселей, иначе встанет на ребро. Esc выходит из режима.`}
        </Text>
      )}

      {handoff !== null && (
        <Stack gap="xs">
          <Alert color="stone" variant="light">
            {`Положение пересчитано по ${formatDecimal(handoff.count)} опорным точкам, ручное совмещение отброшено: опорная точка сдвинулась на ${formatLength(handoff.shift)}, поворот изменился на ${formatDegrees(handoff.rotationChange, 2)}.`}
          </Alert>
          {handoff.big && (
            <Alert color="clay" variant="light">
              {`Большое смещение — проверьте, что точки пары соответствуют друг другу: сдвиг ${formatLength(handoff.shift)} больше габарита контура.`}
            </Alert>
          )}
          <Button variant="default" onClick={() => dispatch(georeferenceActions.manualRestored())}>
            Вернуть ручное
          </Button>
        </Stack>
      )}
      {locked && (
        <Text size="sm" c="dimmed">
          Положение задано опорными точками. Чтобы двигать контур вручную, отключите или удалите
          точки либо верните ручное совмещение.
        </Text>
      )}

      {stats !== null && stats.total > 0 && (
        <Readout
          rows={[
            ['Точек', counts.join(', ')],
            ...(solved
              ? ([
                  ['Невязка RMS', formatLength(stats.rms, 3)],
                  ['Наибольшая', formatLength(stats.max, 3)],
                  ...(stats.controlCount > 0
                    ? ([['RMS по контрольным', formatLength(stats.rmsControl, 3)]] as const)
                    : []),
                ] as const)
              : []),
            [
              'Допуск',
              `${formatLength(stats.tolerance, 2)} — ${formatDecimal(TOLERANCE_MM, 1)}\u00A0мм в масштабе 1:${formatDecimal(workScale)}`,
            ],
          ]}
        />
      )}
      {solved && stats.verdict !== 'none' && (
        <Group gap="xs">
          <Badge variant={VERDICT_BADGE[stats.verdict].variant}>
            {VERDICT_BADGE[stats.verdict].label}
          </Badge>
        </Group>
      )}
      {stats?.exact === true && (
        <Alert color="ochre" variant="light">
          Две пары задают подобие точно: невязки тождественно нулевые, и низкий RMS ничего не
          доказывает. Добавьте третью пару или отметьте одну из точек контрольной.
        </Alert>
      )}

      <Group grow>
        <Select
          label="Масштаб работ"
          data={WORK_SCALES.map((scale) => ({
            value: String(scale),
            label: `1:${formatDecimal(scale)}`,
          }))}
          value={String(workScale)}
          allowDeselect={false}
          onChange={(value) => {
            const scale = WORK_SCALES.find((candidate) => String(candidate) === value);
            if (scale !== undefined)
              dispatch(georeferenceActions.workScaleChanged({ workScale: scale }));
          }}
        />
        <Select
          label="Векторы невязок"
          data={VECTOR_SCALES.map((scale) => ({
            value: String(scale),
            label: scale === 0 ? 'не показывать' : `×${String(scale)}`,
          }))}
          value={String(vectorScale)}
          allowDeselect={false}
          onChange={(value) => {
            const scale = VECTOR_SCALES.find((candidate) => String(candidate) === value);
            if (scale !== undefined) onVectorScale(scale);
          }}
        />
      </Group>
    </Stack>
  );
}

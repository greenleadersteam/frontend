import { NumberInput, Stack, Text, Title } from '@mantine/core';
import { type JSX, useState } from 'react';

import { georeferenceActions } from '@/entities/georeference';
import {
  azimuthY,
  expectedError,
  formatDecimal,
  formatDegrees,
  formatLatLon,
  formatLength,
  normalizeAngle,
  type Placement,
  sizeOnMap,
} from '@/shared/lib/georeference';
import { useAppDispatch } from '@/shared/lib/store';

import { formatModelError } from '../lib/contour-geometry';
import { Readout } from './readout';

type CommittedFieldProps = {
  label: string;
  description: string;
  value: number;
  // Поле принимает значение, только если это конечное число и commit его не отверг.
  valid: (value: number) => boolean;
  error: string;
  onCommit: (value: number) => void;
  // Приведение введённого числа: 360° — это 0°, и поле показывает 0.
  normalize?: (value: number) => number;
  // Знаков после запятой в поле, как в прототипе: поворот — 4, масштаб — 6.
  decimalScale: number;
  suffix?: string;
};

// Число фиксируется по Enter и уходу из поля, а не на каждый символ: иначе «0,0» по дороге
// к «0,001» было бы шагом истории. Значение извне (отмена, жест) сбрасывает поле — его
// пересоздаёт key.
function CommittedField({
  label,
  description,
  value,
  valid,
  error,
  onCommit,
  normalize = (value) => value,
  decimalScale,
  suffix,
}: CommittedFieldProps): JSX.Element {
  const [draft, setDraft] = useState<string | number>(value);
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    const raw = typeof draft === 'number' ? draft : Number(draft.replace(',', '.'));
    if (!Number.isFinite(raw) || !valid(raw)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const number = normalize(raw);
    setDraft(number);
    if (number !== value) onCommit(number);
  };
  return (
    <NumberInput
      label={label}
      description={description}
      value={draft}
      onChange={setDraft}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
      }}
      decimalSeparator=","
      decimalScale={decimalScale}
      hideControls
      suffix={suffix}
      error={invalid ? error : undefined}
    />
  );
}

type BindingPanelProps = {
  placement: Placement | null;
  // В выдвижном блоке заголовок — у самого блока.
  withTitle?: boolean;
};

export function BindingPanel({ placement, withTitle = true }: BindingPanelProps): JSX.Element {
  const title = withTitle && (
    <Title order={2} size="h3">
      Привязка
    </Title>
  );
  const dispatch = useAppDispatch();

  if (placement === null) {
    return (
      <Stack gap="lg">
        {title}
        <Text size="sm" c="dimmed">
          Загрузите контур, перетащите его мышью на место и поверните за круглую ручку. Параметры
          привязки появятся здесь.
        </Text>
      </Stack>
    );
  }

  const { anchor, rotation, scale, source } = placement;
  const size = sizeOnMap(placement);

  return (
    <Stack gap="lg">
      {title}
      <Readout
        rows={[
          ['Опорная точка', formatLatLon(anchor.lat, anchor.lon)],
          [
            'Она же в файле',
            `${formatDecimal(source.center.x, 1)}; ${formatDecimal(source.center.y, 1)}`,
          ],
          // Два знака — ровно то, что уйдёт в выгрузку: поворот ручкой дробный.
          ['Азимут оси +Y', formatDegrees(azimuthY(rotation), 2)],
        ]}
      />
      <CommittedField
        key={`rotation-${String(rotation)}`}
        label="Поворот против часовой"
        description="Q и E — на 0,5°, с Shift — на 5°. Ручка на карте вращает свободно, с Shift — шагом 15°."
        value={rotation}
        valid={() => true}
        error="Введите угол в градусах"
        suffix="°"
        decimalScale={4}
        normalize={normalizeAngle}
        onCommit={(value) => dispatch(georeferenceActions.contourRotated({ rotation: value }))}
      />
      <CommittedField
        key={`scale-${String(scale)}`}
        label="Метров в единице файла"
        description="Если габарит на карте в тысячу раз больше ожидаемого — файл в миллиметрах: 0,001."
        value={scale}
        valid={(value) => value > 0}
        decimalScale={6}
        error="Введите положительное число: 1 для метров, 0,001 для миллиметров"
        onCommit={(value) => dispatch(georeferenceActions.contourScaled({ scale: value }))}
      />
      <Readout
        rows={[
          ['Габарит на карте', `${formatLength(size.width, 1)} × ${formatLength(size.height, 1)}`],
          ['Погрешность модели', formatModelError(expectedError(size.radius))],
        ]}
      />
      <Text size="xs" c="dimmed">
        Погрешность модели — насколько касательная плоскость отходит от эллипсоида на краю участка,
        r³/(3R²). Ошибка ручного совмещения по подложке на порядки больше.
      </Text>
      <Text size="xs" c="dimmed">
        Стрелки сдвигают контур на 1 м, с Shift — на 10 м. Ctrl+Z отменяет, Ctrl+Shift+Z и Ctrl+Y
        возвращают.
      </Text>
      <Text size="xs" c="dimmed">
        Точность ручного совмещения зависит от подложки. Оценки прототипа получены по космоснимку.
      </Text>
    </Stack>
  );
}

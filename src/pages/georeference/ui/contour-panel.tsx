import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
  Title,
} from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { IconFileUpload, IconFocusCentered, IconTrash } from '@tabler/icons-react';
import type { JSX } from 'react';

import { georeferenceActions, type Session } from '@/entities/georeference';
import { diagnose, millimetreHint, UNITS } from '@/shared/lib/contour';
import { formatDecimal, formatLength } from '@/shared/lib/georeference';
import { useAppDispatch } from '@/shared/lib/store';
import { Icon } from '@/shared/ui';

import { MAX_DRAWN_VERTICES } from '../lib/contour-geometry';
import classes from './georeference-page.module.css';
import { Readout } from './readout';
import { ReferenceSymbol } from './reference-symbol';

// GeoJSON приходит и как application/geo+json, и как application/json, и без типа вовсе:
// принимаются расширения.
export const GEOJSON_ACCEPT = {
  'application/geo+json': ['.geojson'],
  'application/json': ['.json', '.geojson'],
};

const OTHER_UNIT = 'other';
const unitOf = (scale: number) =>
  UNITS.find((unit) => unit.scale !== null && Math.abs(scale - unit.scale) <= unit.scale * 1e-9)
    ?.id ?? OTHER_UNIT;

type ContourPanelProps = {
  session: Session;
  fillOpacity: number;
  onFillOpacity: (value: number) => void;
  contourVisible: boolean;
  onContourVisible: (visible: boolean) => void;
  onFiles: (files: File[]) => void;
  onExample: () => void;
  onFit: () => void;
  // Карта ещё не готова или недоступна: контур некуда поставить.
  disabled: boolean;
  // С двух учтённых опорных точек масштаб задают они: единицы вручную не меняются.
  locked: boolean;
  // В выдвижном блоке заголовок — у самого блока.
  withTitle?: boolean;
};

export function ContourPanel({
  session,
  fillOpacity,
  onFillOpacity,
  contourVisible,
  onContourVisible,
  onFiles,
  onExample,
  onFit,
  disabled,
  locked,
  withTitle = true,
}: ContourPanelProps): JSX.Element {
  const dispatch = useAppDispatch();
  const { source, scale } = session;
  // Подсказка про миллиметры — вопрос, пока пользователь сам не выбирал единицы.
  const hint =
    source !== null && !session.unitsConfirmed && scale === 1 && !locked
      ? millimetreHint(source)
      : null;

  return (
    <Stack gap="lg">
      {withTitle && (
        <Title order={2} size="h3">
          Контур
        </Title>
      )}

      <Stack gap="xs">
        <Dropzone
          onDrop={onFiles}
          accept={GEOJSON_ACCEPT}
          multiple
          disabled={disabled}
          className={classes.dropzone}
          // Зона фокусируется и открывает выбор файла по Enter и пробелу: для скринридера это кнопка.
          role="button"
          aria-label="Открыть GeoJSON с границей участка"
        >
          <Stack gap="xs" align="center" className={classes.dropzoneInner}>
            <Icon icon={IconFileUpload} />
            <Text size="sm" fw={600}>
              Перетащите GeoJSON или выберите файл
            </Text>
            <Text size="xs" c="dimmed">
              Можно несколько файлов сразу
            </Text>
          </Stack>
        </Dropzone>
        <Button variant="subtle" disabled={disabled} onClick={onExample}>
          Открыть пример
        </Button>
      </Stack>

      {source !== null && (
        <Stack gap="sm">
          <Text fw={600} className={classes.fileName} title={source.name}>
            {source.name}
          </Text>
          <Readout
            rows={[
              ['Полигонов', formatDecimal(source.counts.polygons)],
              ['Колец', formatDecimal(source.counts.rings)],
              ['Вершин', formatDecimal(source.counts.vertices)],
              [
                'Габарит в файле',
                `${formatDecimal(source.bbox.width, 1)} × ${formatDecimal(source.bbox.height, 1)}`,
              ],
            ]}
          />
          {diagnose(source).map((warning) => (
            <Alert
              key={warning.text}
              color={warning.level === 'danger' ? 'clay' : 'ochre'}
              variant="light"
            >
              {warning.text}
            </Alert>
          ))}
          {hint !== null && (
            <Alert color="stone" variant="light">
              <Stack gap="xs" align="flex-start">
                <Text size="sm">
                  {`Габарит ${formatDecimal(hint.side, 1)}\u00A0единиц. Если файл в миллиметрах, участок — ${formatDecimal(hint.mmWidth, 1)} × ${formatLength(hint.mmHeight, 1)}.`}
                </Text>
                <Button
                  size="compact-sm"
                  variant="default"
                  onClick={() => dispatch(georeferenceActions.contourScaled({ scale: 0.001 }))}
                >
                  Применить миллиметры
                </Button>
              </Stack>
            </Alert>
          )}
          <Select
            disabled={locked}
            label="Единицы файла"
            data={UNITS.map((unit) => ({ value: unit.id, label: unit.title }))}
            value={unitOf(scale)}
            allowDeselect={false}
            onChange={(id) => {
              const unit = UNITS.find((candidate) => candidate.id === id);
              if (unit?.scale != null) {
                dispatch(georeferenceActions.contourScaled({ scale: unit.scale }));
              }
            }}
            description="«Другое» — введите множитель в поле «Метров в единице файла»"
          />
        </Stack>
      )}

      {source !== null && (
        <Stack gap="sm">
          <Title order={3} size="h5">
            Слои
          </Title>
          <Group justify="space-between" wrap="nowrap">
            <Switch
              label="Контур"
              checked={contourVisible}
              onChange={(event) => {
                onContourVisible(event.currentTarget.checked);
              }}
            />
            <Button
              variant="subtle"
              size="compact-sm"
              leftSection={<Icon icon={IconFocusCentered} />}
              onClick={onFit}
            >
              Вписать в вид
            </Button>
          </Group>
          <div>
            <Text size="sm" id="fill-opacity-label">
              Заливка
            </Text>
            <Slider
              min={0}
              max={0.6}
              step={0.05}
              value={fillOpacity}
              onChange={onFillOpacity}
              label={(value) => `${formatDecimal(value * 100)}\u00A0%`}
              thumbProps={{ 'aria-labelledby': 'fill-opacity-label' }}
            />
          </div>
          {source.counts.vertices > MAX_DRAWN_VERTICES && (
            <Text size="xs" c="dimmed">
              {`Вершин больше ${formatDecimal(MAX_DRAWN_VERTICES)}, поэтому точки вершин не рисуются: перерисовка на каждое движение мыши стала бы заметно медленнее. На привязку это не влияет.`}
            </Text>
          )}
        </Stack>
      )}

      {session.references.length > 0 && (
        <Stack gap="xs">
          <Title order={3} size="h5">
            Эталоны
          </Title>
          {session.references.map((reference) => (
            <Group key={reference.id} justify="space-between" wrap="nowrap" gap="xs">
              <Switch
                classNames={{
                  root: classes.referenceSwitch,
                  body: classes.referenceLabel,
                  labelWrapper: classes.referenceLabel,
                  label: classes.fileName,
                }}
                title={reference.name}
                label={
                  <>
                    <ReferenceSymbol reference={reference} />
                    {reference.name}
                  </>
                }
                description={`Вершин: ${formatDecimal(reference.counts.vertices)}`}
                checked={reference.visible}
                onChange={(event) =>
                  dispatch(
                    georeferenceActions.referenceVisibilityChanged({
                      id: reference.id,
                      visible: event.currentTarget.checked,
                    }),
                  )
                }
              />
              <ActionIcon
                variant="subtle"
                aria-label={`Удалить эталон «${reference.name}»`}
                onClick={() => dispatch(georeferenceActions.referenceRemoved({ id: reference.id }))}
              >
                <Icon icon={IconTrash} />
              </ActionIcon>
            </Group>
          ))}
          {session.references.length > 1 && (
            <Button
              variant="subtle"
              onClick={() => dispatch(georeferenceActions.referencesCleared())}
            >
              Удалить все эталоны
            </Button>
          )}
        </Stack>
      )}
    </Stack>
  );
}

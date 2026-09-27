import { ActionIcon, Button, Group, Select, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCircleCheck, IconCircleX, IconX } from '@tabler/icons-react';
import { type JSX, type Ref, useId } from 'react';

import {
  type ExplanationEntry,
  obstacleLabel,
  PLANT_TYPE_LABELS,
  type PlantingCheck,
  type PlantingFeatureCollection,
  type PlantingStatus,
  type PreparedObstacle,
  type Species,
  type ZonesFeatureCollection,
} from '@/entities/project';
import { formatCoordinate, formatDrawingMeters, formatMeters } from '@/shared/lib/format';
import { Icon } from '@/shared/ui';

import { CheckItem } from './check-item';
import classes from './planting-panel.module.css';
import { SourceLink, sourceUrl } from './source-link';

// Размерных линий на карте не больше трёх (dimensionLines): на плане больше не читается.
const DRAWN_CHECKS = 3;

const ROOT_SYSTEM_LABELS = {
  shallow: 'корни поверхностные',
  deep: 'корни стержневые',
  mixed: 'корни смешанные',
} as const;

const STATUS_VIEW = {
  allowed: { text: 'Соответствует нормам', icon: IconCircleCheck, tone: 'accent' },
  forbidden: { text: 'Нарушает норму', icon: IconCircleX, tone: 'error' },
  rejected: { text: 'Вне разрешённой области', icon: IconAlertTriangle, tone: 'error' },
} as const satisfies Record<
  PlantingStatus,
  { text: string; icon: typeof IconX; tone: 'accent' | 'error' }
>;

// Правка посадки для карточки: статус, на сколько перемещена, сколько крон задевает.
export type PlantingEditView = {
  status: PlantingStatus;
  // Метры от исходной точки; null — не перемещалась.
  movedBy: number | null;
  overlaps: number;
};

type PlantingPanelProps = {
  // Панель получает фокус, когда открыта из другой панели или из ведомости.
  ref: Ref<HTMLDivElement>;
  planting: PlantingFeatureCollection['features'][number]['properties'];
  entry: ExplanationEntry | undefined;
  // Координаты ствола в чертеже; null — неизвестны (правленая посадка на геопривязанном плане).
  drawing: { x: number; y: number } | null;
  // Порода из /species (возможность species); null — породы нет или возможности нет.
  species: Species | null;
  edit: PlantingEditView | null;
  // Режим правки: смена породы и «Вернуть на место».
  editing: boolean;
  // Породы этого типа посадки для смены; пусто — справочника нет.
  speciesOptions: Species[];
  onSpeciesChange: (speciesId: string | null) => void;
  onRestore: () => void;
  // WGS84 — только у проекта с геопривязкой.
  coordinates: { lat: number; lon: number } | null;
  checks: PlantingCheck[];
  uncovered: ZonesFeatureCollection['metadata']['uncovered_categories'];
  usedSiteBoundary: boolean;
  // Ограничение под курсором или в фокусе: его размерная линия выделена на карте.
  onFocusCheck: (index: number | null) => void;
  // Открыть панель зоны запрета или объекта: путь к ним без щелчка по карте, в том числе
  // с клавиатуры.
  onShowZone: (index: number) => void;
  onShowObstacle: (obstacle: PreparedObstacle) => void;
  onClose: () => void;
};

// Обоснование посадки по тому, что отдаёт бэкенд: проверки — серверные checks или свой расчёт
// до объектов подосновы (/obstacles), без них — по геометрии зон запрета (/zones). Пункты норм —
// только из /norms или citation.
export function PlantingPanel({
  ref,
  planting,
  entry,
  drawing,
  species,
  edit,
  editing,
  speciesOptions,
  onSpeciesChange,
  onRestore,
  coordinates,
  checks,
  uncovered,
  usedSiteBoundary,
  onFocusCheck,
  onShowZone,
  onShowObstacle,
  onClose,
}: PlantingPanelProps): JSX.Element {
  const titleId = useId();
  const checksId = useId();
  const coordinateLines = [
    ...(coordinates === null
      ? []
      : [`Ш ${formatCoordinate(coordinates.lat)}, Д ${formatCoordinate(coordinates.lon)}`]),
    ...(drawing === null
      ? []
      : [
          `В координатах чертежа: X ${formatDrawingMeters(drawing.x)}, Y ${formatDrawingMeters(drawing.y)}`,
        ]),
  ];

  // Clipboard API есть только в защищённом контексте и может отказать без фокуса документа.
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(coordinateLines.join('\n'));
      notifications.show({ message: 'Координаты скопированы' });
    } catch {
      notifications.show({
        color: 'clay',
        message: 'Не удалось скопировать координаты. Выделите их и скопируйте вручную.',
      });
    }
  };

  return (
    <Stack
      ref={ref}
      tabIndex={-1}
      gap="md"
      className={classes.panel}
      aria-labelledby={titleId}
      role="region"
    >
      <Group
        justify="space-between"
        wrap="nowrap"
        gap="sm"
        align="flex-start"
        className={classes.header}
      >
        <Stack gap={0}>
          <Title order={2} id={titleId} className={classes.title}>
            {species?.name_ru ?? PLANT_TYPE_LABELS[planting.plant_type]}
          </Title>
          {species !== null && (
            <Text size="sm" c="dimmed" fs="italic">
              {species.name_lat}
            </Text>
          )}
        </Stack>
        <ActionIcon variant="subtle" aria-label="Закрыть" onClick={onClose}>
          <Icon icon={IconX} />
        </ActionIcon>
      </Group>

      <Stack gap={0}>
        {entry?.rule_name_ru != null && <Text>{entry.rule_name_ru}</Text>}
        <Text size="sm" c="dimmed" className={classes.numbers}>
          {species === null
            ? planting.id
            : `${PLANT_TYPE_LABELS[planting.plant_type]}, ${planting.id}`}
        </Text>
      </Stack>

      {edit !== null && (
        <Stack gap="xs" align="flex-start">
          <Group gap="xs" wrap="nowrap">
            <Icon
              icon={STATUS_VIEW[edit.status].icon}
              tone={STATUS_VIEW[edit.status].tone}
              label={STATUS_VIEW[edit.status].text}
            />
            <Text fw={600}>{STATUS_VIEW[edit.status].text}</Text>
          </Group>
          {edit.movedBy !== null && (
            <Group gap="xs">
              <Text size="sm" className={classes.numbers}>
                {`Перемещено на ${formatMeters(edit.movedBy, 1)}`}
              </Text>
              {editing && (
                <Button variant="subtle" size="compact-sm" onClick={onRestore}>
                  Вернуть на место
                </Button>
              )}
            </Group>
          )}
          {edit.overlaps > 0 && (
            <Text size="sm" className={classes.caution}>
              Кроны пересекаются с соседними посадками
            </Text>
          )}
        </Stack>
      )}

      {editing && speciesOptions.length > 0 && (
        <Select
          label="Порода"
          placeholder="Порода не выбрана"
          data={speciesOptions.map(({ id, name_ru: name }) => ({ value: id, label: name }))}
          value={planting.species_id ?? null}
          onChange={onSpeciesChange}
          searchable
          clearable
          nothingFoundMessage="Порода не найдена"
        />
      )}

      {species !== null && (
        <SpeciesReason species={species} reason={planting.species_reason_ru ?? null} />
      )}

      <Stack gap="xs">
        <Title order={3} id={checksId} className={classes.section}>
          Проверки
        </Title>
        {checks.length === 0 ? (
          <Text size="sm" c="dimmed">
            Рядом нет ограничений из проверенных категорий
          </Text>
        ) : (
          <ul className={classes.checks} aria-labelledby={checksId}>
            {checks.map((check, index) => (
              <CheckItem
                // У зоны — её номер, у объекта — подтип: в списке по проверке на подтип.
                key={
                  check.kind === 'object'
                    ? `${check.category}|${String(check.subtype)}`
                    : check.zone.index
                }
                check={check}
                onFocus={() => {
                  onFocusCheck(index);
                }}
                onBlur={() => {
                  onFocusCheck(null);
                }}
                onShowZone={onShowZone}
                onShowObstacle={onShowObstacle}
              />
            ))}
          </ul>
        )}
        {checks.length > DRAWN_CHECKS && (
          <Text size="sm" c="dimmed">
            Размерные линии показаны для трёх ближайших
          </Text>
        )}
      </Stack>

      {uncovered.length > 0 && (
        <Stack gap="xs">
          <Title order={3} className={classes.section}>
            Не проверялось
          </Title>
          <Text size="sm">
            {`Отступы не проверялись для объектов: ${uncovered
              .map(({ category, subtype }) => obstacleLabel(category, subtype).toLowerCase())
              .join(', ')}`}
          </Text>
        </Stack>
      )}
      {!usedSiteBoundary && (
        // Без границы участка бэкенд берёт весь газон (../backend/greenplan/zoning/engine.py:108-111).
        <Text size="sm">
          Граница участка в чертеже не найдена: посадки размещены по всему газону
        </Text>
      )}

      {coordinateLines.length > 0 && (
        <Stack gap={0} align="flex-start">
          {coordinateLines.map((line) => (
            <Text key={line} size="sm" className={classes.numbers}>
              {line}
            </Text>
          ))}
          <Button variant="subtle" size="compact-sm" onClick={() => void copy()}>
            Скопировать
          </Button>
        </Stack>
      )}
    </Stack>
  );
}

type SpeciesReasonProps = { species: Species; reason: string | null };

// Почему выбрана порода и что о ней известно — только то, что даёт источник: без кроны или
// корней в справочнике их нет и в строке.
function SpeciesReason({ species, reason }: SpeciesReasonProps): JSX.Element {
  const params = [
    ...(species.crown_diameter_m === null
      ? []
      : [`крона до ${formatMeters(species.crown_diameter_m)}`]),
    `высота до ${formatMeters(species.height_m)}`,
    ...(species.root_system === null ? [] : [ROOT_SYSTEM_LABELS[species.root_system]]),
  ].join(', ');
  const source = sourceUrl(species.source);

  return (
    <Stack gap="xs" align="flex-start">
      <Title order={3} className={classes.section}>
        Почему эта порода
      </Title>
      {reason !== null && <Text size="sm">{reason}</Text>}
      <Text size="sm" c="dimmed">
        {params.charAt(0).toUpperCase() + params.slice(1)}
      </Text>
      {source !== null && (
        <SourceLink href={source} label={`Источник данных о породе: ${species.name_ru}`} />
      )}
    </Stack>
  );
}

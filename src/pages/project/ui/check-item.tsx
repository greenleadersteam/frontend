import { Button, Group, Stack, Text } from '@mantine/core';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleX,
  IconInfoCircle,
} from '@tabler/icons-react';
import { type JSX, useState } from 'react';

import {
  checkBasis,
  type NormBasis,
  obstacleLabel,
  type PlantingCheck,
  type PlantType,
  type PreparedObstacle,
  TOLERANCE_M,
} from '@/entities/project';
import { formatMeters } from '@/shared/lib/format';
import { Icon } from '@/shared/ui';

import { normReference } from './norm-reference';
import classes from './planting-panel.module.css';
import { SourceLink, sourceUrl } from './source-link';

type CheckItemProps = {
  check: PlantingCheck;
  plantType: PlantType;
  // Крона породы больше 5 м: по примечанию 1 к табл. 3.6.1 отступ следует увеличить.
  crownOverNote: boolean;
  onFocus: () => void;
  onBlur: () => void;
  // Без него у проверки по зоне нет кнопки «Показать зону».
  onShowZone?: (index: number) => void;
  onShowObstacle: (obstacle: PreparedObstacle) => void;
};

// Пункт проверки: объект, фактическое расстояние и норма, откуда норма, путь к зоне или объекту.
type CheckView = {
  obstacle: string;
  // null — посадка внутри зоны запрета, расстояния нет.
  distance: string | null;
  violated: boolean;
  // Меньше нормы, но в пределах точности расчёта: без пояснения галочка рядом с таким числом
  // читалась бы как ошибка.
  withinTolerance: boolean;
  reference: string;
  basis: NormBasis | null;
  // Пояснение зоны сервера (reason) — видно сразу; текст нормы из /norms — по кнопке.
  note: string;
  normText: string | null;
  source: string | null;
  show: { label: string; action: () => void } | null;
};

// Отступ, которого нет в акте, не называется нормой: «при отступе», а не «при норме».
const requirement = (basis: NormBasis | null) =>
  basis?.basis === 'service_default' ? 'при отступе не менее' : 'при норме не менее';

// Консервативное значение сервиса — не требование закона: вместо ссылки на пункт — почему
// нормы нет (contracts/norms-verified.md).
export const serviceDefaultText = (distance: number, reason: string): string =>
  `Отступ ${formatMeters(distance)} — консервативное значение сервиса. ${reason}.`;

function viewOf(
  check: PlantingCheck,
  plantType: PlantType,
  onShowZone: ((index: number) => void) | undefined,
  onShowObstacle: (obstacle: PreparedObstacle) => void,
): CheckView {
  const basis = checkBasis(check, plantType);
  const serviceDefault = basis?.basis === 'service_default' ? basis : null;
  if (check.kind === 'object') {
    const { obstacle } = check;
    return {
      obstacle: obstacleLabel(check.category, check.subtype),
      // Расстояние до геометрии объекта — с сантиметрами, как у сервера.
      distance: `${formatMeters(check.actual, 2)} ${requirement(basis)} ${formatMeters(check.required)}`,
      violated: check.violated,
      withinTolerance: !check.violated && check.actual < check.required,
      reference:
        serviceDefault === null
          ? normReference(check.norm, check.citation)
          : serviceDefaultText(check.required, serviceDefault.reason),
      basis,
      note: '',
      // У значения сервиса текст нормы и есть причина: он уже в строке основания.
      normText: serviceDefault === null ? (check.norm?.text ?? null) : null,
      source: sourceUrl(check.norm?.source_url ?? null),
      show:
        obstacle === null
          ? null
          : {
              label: 'Показать объект',
              action: () => {
                onShowObstacle(obstacle);
              },
            },
    };
  }
  const { properties, index } = check.zone;
  const citation = properties.citation.trim();
  const reason = properties.reason.trim();
  return {
    obstacle: obstacleLabel(properties.obstacle_category, properties.obstacle_subtype),
    distance:
      check.kind === 'measured'
        ? `${formatMeters(check.actual, 1)} ${requirement(basis)} ${formatMeters(properties.distance_m)}`
        : check.kind === 'boundary'
          ? `до границы зоны ${formatMeters(check.margin, 1)}`
          : null,
    violated: check.kind === 'inside',
    withinTolerance: false,
    reference:
      serviceDefault === null
        ? normReference(null, citation)
        : serviceDefaultText(properties.distance_m, serviceDefault.reason),
    basis,
    note: reason === citation ? '' : reason,
    normText: null,
    source: null,
    show:
      onShowZone === undefined
        ? null
        : {
            label: 'Показать зону',
            action: () => {
              onShowZone(index);
            },
          },
  };
}

// Значение сервиса нормой не называется и при нарушении.
const violationLabel = (basis: NormBasis | null): string =>
  basis?.basis === 'service_default' ? 'Отступ сервиса нарушен' : 'Норма нарушена';

export const CROWN_NOTE =
  'Крона породы больше 5\u00A0м — по примечанию 1 к табл. 3.6.1 отступ следует увеличить';

// Пункт проверки: в карточке посадки и в панели отклонённого места — в одном виде.
export function CheckItem({
  check,
  plantType,
  crownOverNote,
  onFocus,
  onBlur,
  onShowZone,
  onShowObstacle,
}: CheckItemProps): JSX.Element {
  const view = viewOf(check, plantType, onShowZone, onShowObstacle);
  const [normShown, setNormShown] = useState(false);

  return (
    <li
      className={classes.check}
      // Фокус с клавиатуры выделяет размерную линию ограничения на карте, как наведение мышью.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- действия нет, только выделение на карте
      tabIndex={0}
      onMouseEnter={onFocus}
      onMouseLeave={onBlur}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {check.kind === 'inside' ? (
        <Icon icon={IconAlertTriangle} tone="error" label={violationLabel(view.basis)} />
      ) : view.violated ? (
        <Icon icon={IconCircleX} tone="error" label={violationLabel(view.basis)} />
      ) : view.basis?.basis === 'service_default' ? (
        // Не требование закона: «выполнено» было бы неправдой.
        <Icon icon={IconInfoCircle} label="Значение сервиса" />
      ) : (
        <Icon icon={IconCircleCheck} tone="accent" label="Норма выполнена" />
      )}
      <Stack gap="xs">
        <Text fw={600}>{view.obstacle}</Text>
        {view.distance === null ? (
          <Text size="sm" className={classes.warning}>
            Посадка внутри зоны запрета — сообщите разработчикам
          </Text>
        ) : (
          <Text size="sm" className={view.violated ? classes.warning : classes.numbers}>
            {view.distance}
          </Text>
        )}
        {view.withinTolerance && (
          <Text size="sm">{`В пределах точности расчёта: ${formatMeters(TOLERANCE_M, 2)}`}</Text>
        )}
        <Text size="sm" c="dimmed">
          {view.reference}
        </Text>
        {crownOverNote && view.basis?.basis === 'regulation' && <Text size="sm">{CROWN_NOTE}</Text>}
        {view.note !== '' && (
          <Text size="sm" c="dimmed">
            {view.note}
          </Text>
        )}
        {(view.normText !== null || view.source !== null) && (
          <Group gap={0} className={classes.actions}>
            {view.normText !== null && (
              <Button
                variant="subtle"
                size="compact-sm"
                aria-expanded={normShown}
                onClick={() => {
                  setNormShown((shown) => !shown);
                }}
              >
                Текст нормы
              </Button>
            )}
            {view.source !== null && (
              <SourceLink href={view.source} label={`Источник нормы: ${view.obstacle}`} />
            )}
          </Group>
        )}
        {normShown && view.normText !== null && (
          <Text size="sm" c="dimmed">
            {view.normText}
          </Text>
        )}
        {view.show !== null && (
          <Button
            variant="subtle"
            size="compact-sm"
            className={classes.showZone}
            onClick={view.show.action}
            aria-label={`${view.show.label}: ${view.obstacle}`}
          >
            {view.show.label}
          </Button>
        )}
      </Stack>
    </li>
  );
}

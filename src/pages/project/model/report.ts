import {
  checkBasis,
  type ExplanationEntry,
  type Norm,
  type NormBasis,
  NOTE_1_CROWN_LIMIT_M,
  obstacleLabel,
  type PlantingCheck,
  type PlantingStatus,
  type PlantType,
  type Species,
} from '@/entities/project';
import type { FinalPlanting } from '@/features/edit-plantings';

// Проверка посадки в отчёте: объект, факт, требование и основание.
// Как измерено — так же, как в карточке посадки: до объекта, через зону запрета (measured),
// до границы срезанной зоны (boundary) или посадка внутри зоны.
export type ReportCheck = (
  { kind: 'object' | 'measured'; actual: number } | { kind: 'boundary' | 'inside'; actual: null }
) & {
  object: string;
  category: string;
  subtype: string | null;
  required: number;
  // Запас до требования, м: отрицательный — нарушение. Внутри зоны — минус бесконечность.
  margin: number;
  violated: boolean;
  // Меньше требования, но в пределах точности расчёта.
  withinTolerance: boolean;
  basis: NormBasis | null;
  // Как норму называет сервер: пункт из /norms или строка citation.
  citation: string;
  norm: Norm | null;
};

export type ReportPlanting = {
  id: string;
  plantType: PlantType;
  ruleName: string | null;
  changed: boolean;
  status: PlantingStatus;
  // Крона породы больше 5 м: по примечанию 1 к табл. 3.6.1 отступ следует увеличить.
  crownOverNote: boolean;
  checks: ReportCheck[];
};

function reportCheck(check: PlantingCheck, plantType: PlantType): ReportCheck {
  const basis = checkBasis(check, plantType);
  if (check.kind === 'object') {
    return {
      kind: check.kind,
      object: obstacleLabel(check.category, check.subtype),
      category: check.category,
      subtype: check.subtype,
      actual: check.actual,
      required: check.required,
      margin: check.actual - check.required,
      violated: check.violated,
      withinTolerance: !check.violated && check.actual < check.required,
      basis,
      citation: check.citation,
      norm: check.norm,
    };
  }
  const { properties } = check.zone;
  const measurement =
    check.kind === 'measured'
      ? { kind: check.kind, actual: check.actual }
      : { kind: check.kind, actual: null };
  return {
    ...measurement,
    object: obstacleLabel(properties.obstacle_category, properties.obstacle_subtype),
    category: properties.obstacle_category,
    subtype: properties.obstacle_subtype,
    required: properties.distance_m,
    // До зоны запрета — это и есть запас сверх нормы.
    margin: check.kind === 'inside' ? Number.NEGATIVE_INFINITY : check.margin,
    violated: check.kind === 'inside',
    withinTolerance: false,
    basis,
    citation: properties.citation,
    norm: null,
  };
}

type ReportInput = {
  planting: FinalPlanting;
  statuses: ReadonlyMap<string, PlantingStatus>;
  entries: ReadonlyMap<string, ExplanationEntry>;
  species: ReadonlyMap<string, Species>;
  checksOf: (feature: FinalPlanting['features'][number]) => PlantingCheck[];
};

export function reportPlantings({
  planting,
  statuses,
  entries,
  species,
  checksOf,
}: ReportInput): ReportPlanting[] {
  return planting.features.map((feature) => {
    const { properties } = feature;
    const crown =
      properties.species_id == null ? null : species.get(properties.species_id)?.crown_diameter_m;
    return {
      id: properties.id,
      plantType: properties.plant_type,
      ruleName: entries.get(properties.id)?.rule_name_ru ?? null,
      changed:
        properties.origin === 'manual' ||
        properties.moved_from !== null ||
        properties.species_changed,
      status: statuses.get(properties.id) ?? 'allowed',
      // Примечание 1 к табл. 3.6.1 говорит о деревьях.
      crownOverNote: properties.plant_type === 'tree' && (crown ?? 0) > NOTE_1_CROWN_LIMIT_M,
      checks: checksOf(feature).map((check) => reportCheck(check, properties.plant_type)),
    };
  });
}

// Сколько посадок с наименьшим запасом показывать по каждому подтипу сети.
const NEAREST_PER_UTILITY = 3;

// Посадки раздела «Проверки по посадкам» по умолчанию: с правками, нарушениями и
// предупреждениями (в пределах точности расчёта, крона больше 5 м при норме акта) и по три
// с наименьшим запасом до каждого подтипа сети. Порядок — как в расстановке.
export function defaultReportSelection(plantings: readonly ReportPlanting[]): ReportPlanting[] {
  const selected = new Set<string>();
  for (const planting of plantings) {
    const flagged =
      planting.changed ||
      planting.status !== 'allowed' ||
      planting.checks.some(
        (check) =>
          check.violated ||
          check.withinTolerance ||
          (planting.crownOverNote && check.basis?.basis === 'regulation'),
      );
    if (flagged) selected.add(planting.id);
  }
  const bySubtype = new Map<string, { id: string; margin: number }[]>();
  for (const planting of plantings) {
    for (const check of planting.checks) {
      if (check.category !== 'underground_utilities') continue;
      const key = check.subtype ?? '';
      const list = bySubtype.get(key) ?? [];
      list.push({ id: planting.id, margin: check.margin });
      bySubtype.set(key, list);
    }
  }
  for (const list of bySubtype.values()) {
    const nearest = new Set<string>();
    for (const { id } of list.sort((a, b) => a.margin - b.margin)) {
      if (nearest.size === NEAREST_PER_UTILITY) break;
      nearest.add(id);
    }
    for (const id of nearest) selected.add(id);
  }
  return plantings.filter(({ id }) => selected.has(id));
}

// Применённая норма: объект, тип посадки, отступ и основание.
export type AppliedNorm = {
  key: string;
  object: string;
  plantType: PlantType;
  required: number;
  basis: NormBasis | null;
  citation: string;
  norm: ReportCheck['norm'];
};

// Только нормы, которые сработали хотя бы для одной посадки: по ним есть проверка.
export function appliedNorms(plantings: readonly ReportPlanting[]): AppliedNorm[] {
  const norms = new Map<string, AppliedNorm>();
  for (const planting of plantings) {
    for (const check of planting.checks) {
      const key = `${check.category}|${check.subtype ?? ''}|${planting.plantType}|${String(check.required)}`;
      if (norms.has(key)) continue;
      norms.set(key, {
        key,
        object: check.object,
        plantType: planting.plantType,
        required: check.required,
        basis: check.basis,
        citation: check.citation,
        norm: check.norm,
      });
    }
  }
  const collator = new Intl.Collator('ru-RU');
  return [...norms.values()].sort(
    // Внутри объекта деревья идут раньше кустарников, как в ведомости.
    (a, b) =>
      collator.compare(a.object, b.object) ||
      Number(a.plantType === 'shrub') - Number(b.plantType === 'shrub'),
  );
}

// Нормы, которые в сервисе есть (../backend/greenplan/norms/default.yaml), но объектов для них
// распознавание чертежа не выдаёт (../backend/greenplan/rules/default.yaml): трамвайных путей
// и канав в правилах нет, а воздушные ЛЭП распознаются без напряжения (правило 91, 6d2016b) —
// отступ по напряжению не применяется. Категории улиц сервис распознаёт с 6d2016b. Здания школ
// и детских садов — только по данным Overture (1208ed4): без её кэша и у зданий без класса они
// проверены как прочие здания, поэтому строка остаётся. Значения — contracts/norms-verified.md;
// нормы ЛЭП там не сверены.
export const NORMS_NOT_RECOGNIZED = [
  {
    object: 'Стена школы, детского сада, если Overture не знает класс здания',
    values: 'дерево 10,0\u00A0м, кустарник 1,5\u00A0м',
    reference: 'ПП Москвы №\u00A0743-ПП, п. 3.6.3, табл. 3.6.1',
  },
  {
    object: 'Ось трамвайных путей, край трамвайного полотна',
    values: 'дерево 5,0\u00A0м, кустарник 3,0\u00A0м',
    reference: 'ПП Москвы №\u00A0743-ПП, табл. 3.6.1; СП 42.13330.2016, табл. 9.1',
  },
  {
    object: 'Бровка канавы',
    values: 'дерево 2,0\u00A0м, кустарник 1,0\u00A0м',
    reference: 'ПП Москвы №\u00A0743-ПП, табл. 3.6.1; СП 42.13330.2016, табл. 9.1',
  },
  {
    object: 'Воздушная линия электропередачи по напряжению',
    values: '2,0–55,0\u00A0м по напряжению, для дерева и кустарника',
    reference:
      'ПУЭ; ПП РФ от 24.02.2009 №\u00A0160 — по ссылке сервиса, с первоисточником не сверено',
  },
] as const;

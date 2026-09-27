import type { Norm } from '../api/project-result-api';
import type { PlantType } from '../model/project';
import type { PlantingCheck } from './planting-checks';

// Основание отступа: требование акта или консервативное значение сервиса, которого в акте нет.
// У service_default — фраза, почему нормы нет; она идёт в карточку и в отчёт.
export type NormBasis = { basis: 'regulation' } | { basis: 'service_default'; reason: string };

type VerifiedNorm = { distance: number; basis: NormBasis };

const REGULATION = { basis: 'regulation' } as const;
const noNorm = (reason: string) => ({ basis: 'service_default', reason }) as const;

// Основание норм сервиса на фронте: без возможности norms у сервера нет поля basis. Таблица —
// строки «Нормы сервиса» из contracts/norms-verified.md: значение сервиса и основание для
// дерева и кустарника. Когда бэкенд отдаст /norms, модуль удаляется. Второе место, где фронт
// знает нормы, — список норм первоисточника, которых нет в сервисе (pages/project/model/report.ts).
const VERIFIED: Record<string, Record<PlantType, VerifiedNorm>> = {
  'underground_utilities|gas': {
    tree: { distance: 1.5, basis: REGULATION },
    shrub: {
      distance: 1.5,
      basis: noNorm(
        'Для кустарника у газопровода норма в ПП №\u00A0743-ПП, табл. 3.6.1, не установлена',
      ),
    },
  },
  'underground_utilities|heat': {
    tree: { distance: 2, basis: REGULATION },
    shrub: { distance: 1, basis: REGULATION },
  },
  'underground_utilities|water': {
    tree: { distance: 2, basis: REGULATION },
    shrub: {
      distance: 2,
      basis: noNorm(
        'Для кустарника у водопровода норма в ПП №\u00A0743-ПП, табл. 3.6.1, не установлена',
      ),
    },
  },
  'underground_utilities|drainage': {
    tree: { distance: 2, basis: REGULATION },
    shrub: {
      distance: 2,
      basis: noNorm(
        'Для кустарника у дренажа норма в ПП №\u00A0743-ПП, табл. 3.6.1, не установлена',
      ),
    },
  },
  'underground_utilities|sewer': {
    tree: { distance: 1.5, basis: REGULATION },
    shrub: {
      distance: 1.5,
      basis: noNorm(
        'Для кустарника у канализации норма в ПП №\u00A0743-ПП, табл. 3.6.1, не установлена',
      ),
    },
  },
  'underground_utilities|power_cable': {
    tree: { distance: 2, basis: REGULATION },
    shrub: { distance: 0.7, basis: REGULATION },
  },
  'underground_utilities|comm_cable': {
    tree: { distance: 2, basis: REGULATION },
    shrub: { distance: 0.7, basis: REGULATION },
  },
  'underground_utilities|other_utility': {
    tree: {
      distance: 2,
      basis: noNorm('Для неопознанной подземной сети строки в ПП №\u00A0743-ПП, табл. 3.6.1, нет'),
    },
    shrub: {
      distance: 2,
      basis: noNorm('Для неопознанной подземной сети строки в ПП №\u00A0743-ПП, табл. 3.6.1, нет'),
    },
  },
  'road_edge|': {
    tree: { distance: 0.7, basis: REGULATION },
    shrub: { distance: 0.5, basis: REGULATION },
  },
  'green_existing|existing_tree': {
    tree: {
      distance: 5,
      basis: noNorm(
        'Табл. 3.6.2 ПП №\u00A0743-ПП задаёт ориентировочный шаг посадки деревьев 5–6\u00A0м, а не отступ от существующего дерева',
      ),
    },
    shrub: {
      distance: 1.5,
      basis: noNorm(
        'Для кустарника у существующего дерева норма в ПП №\u00A0743-ПП не установлена',
      ),
    },
  },
};

// Основание отступа для проверки. С /norms — поле basis сервера и его текст; без него —
// сверенная таблица, и только если значение сервиса с ней совпадает: другое число таблица
// не подтверждает. null — основание неизвестно, проверка показывается без него.
export function normBasis(
  norm: Norm | null,
  category: string,
  subtype: string | null,
  plantType: PlantType,
  distance: number,
): NormBasis | null {
  if (norm !== null) {
    return norm.basis === 'regulation' ? REGULATION : noNorm(norm.text);
  }
  const verified = VERIFIED[`${category}|${subtype ?? ''}`]?.[plantType];
  return verified !== undefined && Math.abs(verified.distance - distance) < 1e-9
    ? verified.basis
    : null;
}

// Основание проверки посадки: у проверки по объекту — норма /norms и отступ из неё, у проверки
// по зоне запрета — объект, тип посадки и ширина зоны.
export function checkBasis(check: PlantingCheck, plantType: PlantType): NormBasis | null {
  if (check.kind === 'object') {
    return normBasis(check.norm, check.category, check.subtype, plantType, check.required);
  }
  const { properties } = check.zone;
  return normBasis(
    null,
    properties.obstacle_category,
    properties.obstacle_subtype,
    properties.plant_type,
    properties.distance_m,
  );
}

// Примечание 1 к табл. 3.6.1 743-ПП: нормы даны для деревьев с кроной не больше 5 м, для
// более крупных их увеличивают. Насколько — акт не говорит, поэтому своё число не выдумываем.
export const NOTE_1_CROWN_LIMIT_M = 5;

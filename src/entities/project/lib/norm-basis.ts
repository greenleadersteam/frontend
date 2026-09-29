import type { Norm } from '../api/project-result-api';
import type { PlantType } from '../model/project';
import type { PlantingCheck } from './planting-checks';

// Акт и пункт нормы по сверке с текстом акта и адрес текста, который сверялся
// (contracts/norms-verified.md).
// actMark и table — как акт и таблицу называет citation сервера: по ним ссылка сервера
// сопоставляется со сверкой.
export type VerifiedClause = {
  act: string;
  clause: string;
  actMark: string;
  table: string;
  source: string;
};

// Основание отступа: требование акта или консервативное значение сервиса, которого в акте нет.
// У regulation из сверенной таблицы — пункт по сверке: в citation сервера есть таблица, но нет
// «прил. 1, п. 3.6.3», а ТЗ (п. 2.8, 7.2.6) требует конкретный пункт. С /norms пункт даёт сервер.
// У service_default — фраза, почему нормы нет; она идёт в карточку и в отчёт.
export type NormBasis =
  | { basis: 'regulation'; verified: VerifiedClause | null }
  | { basis: 'service_default'; reason: string };

type VerifiedNorm = { distance: number; basis: NormBasis };

// Пункт 3.6.3 приложения 1 содержит таблицу 3.6.1 «Расстояние от сооружений до посадок растений».
const ACT_743 = {
  act: 'ПП Москвы №\u00A0743-ПП',
  clause: 'прил. 1, п. 3.6.3, табл. 3.6.1',
  actMark: '743-ПП',
  table: 'табл. 3.6.1',
  source: 'https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/',
};
// Край трамвайного полотна сверен по СП 42, в табл. 3.6.1 743-ПП такой строки нет.
const SP_42 = {
  act: 'СП 42.13330.2016',
  clause: 'п. 9.6, табл. 9.1',
  actMark: 'СП 42',
  table: 'табл. 9.1',
  source: 'https://tiflocentre.ru/documents/sp42-13330-2016.php',
};
const REGULATION = { basis: 'regulation', verified: ACT_743 } as const;
const SERVER_REGULATION = { basis: 'regulation', verified: null } as const;
const noNorm = (reason: string) => ({ basis: 'service_default', reason }) as const;

// Основание норм сервиса на фронте: без возможности norms у сервера нет поля basis. Таблица —
// строки «Нормы сервиса» из contracts/norms-verified.md: значение сервиса и основание для
// дерева и кустарника. Когда бэкенд отдаст /norms, модуль удаляется. Второе место, где фронт
// знает нормы, — список норм, объекты которых распознавание не выдаёт (pages/project/model/report.ts).
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
  // Бортовой камень сервис считает краем проезжей части (../backend/greenplan/norms/default.yaml).
  'road_edge|': {
    tree: { distance: 2, basis: REGULATION },
    shrub: { distance: 1, basis: REGULATION },
  },
  // Проезжая часть без категории улицы — та же норма края проезжей части (norms/default.yaml,
  // 6d2016b). С категорией — МГСН 1.02-02, табл. 9.1: с первоисточником не сверено
  // (contracts/norms-verified.md), основание не показывается.
  'carriageway|': {
    tree: { distance: 2, basis: REGULATION },
    shrub: { distance: 1, basis: REGULATION },
  },
  'footpath_edge|': {
    tree: { distance: 0.7, basis: REGULATION },
    shrub: { distance: 0.5, basis: REGULATION },
  },
  'buildings|': {
    tree: { distance: 5, basis: REGULATION },
    shrub: { distance: 1.5, basis: REGULATION },
  },
  'buildings|school_kindergarten': {
    tree: { distance: 10, basis: REGULATION },
    shrub: { distance: 1.5, basis: REGULATION },
  },
  'poles_masts|': {
    tree: { distance: 4, basis: REGULATION },
    shrub: {
      distance: 4,
      basis: noNorm(
        'Для кустарника у мачты и опоры норма в ПП №\u00A0743-ПП, табл. 3.6.1, не установлена',
      ),
    },
  },
  'retaining_walls_slopes|slope': {
    tree: { distance: 1, basis: REGULATION },
    shrub: { distance: 0.5, basis: REGULATION },
  },
  'retaining_walls_slopes|retaining_wall': {
    tree: { distance: 3, basis: REGULATION },
    shrub: { distance: 1, basis: REGULATION },
  },
  'ditch_edge|': {
    tree: { distance: 2, basis: REGULATION },
    shrub: { distance: 1, basis: REGULATION },
  },
  'tram_tracks|axis': {
    tree: { distance: 5, basis: REGULATION },
    shrub: { distance: 3, basis: REGULATION },
  },
  'tram_tracks|bed_edge': {
    tree: { distance: 5, basis: { basis: 'regulation', verified: SP_42 } },
    shrub: { distance: 3, basis: { basis: 'regulation', verified: SP_42 } },
  },
  'green_existing|existing_tree': {
    tree: {
      distance: 6,
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
    return norm.basis === 'regulation' ? SERVER_REGULATION : noNorm(norm.text);
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

// Пометка источника пункта: его прислал не сервер, а даёт сверка фронтенда с текстом акта.
export const VERIFIED_CLAUSE_NOTE = 'пункт — по сверке с текстом акта';

export const verifiedReference = ({ act, clause }: VerifiedClause): string => `${act}, ${clause}`;

import { formatMeters } from '@/shared/lib/format';

import type { components } from '../../generated/proposed';
import type { RunParams } from './site';

type Species = components['schemas']['Species'];
type PlantType = components['schemas']['PlantType'];

const ASSORTMENT = 'Ассортимент: 623-ПП, прил. В, табл. В.6';

// Справочник пород для демо — только из contracts/species-verified.md: ассортимент — таблица В.6
// 623-ПП, параметры — открытые статьи. Крона и корни, которых источник не даёт, — null.
export const SPECIES: Species[] = [
  {
    id: 'tilia_cordata',
    name_ru: 'Липа мелколистная',
    name_lat: 'Tilia cordata',
    plant_type: 'tree',
    crown_diameter_m: null,
    height_m: 25,
    root_system: null,
    source: `${ASSORTMENT}. Высота: https://ru.wikipedia.org/wiki/Липа_сердцевидная`,
  },
  {
    id: 'acer_platanoides',
    name_ru: 'Клён остролистный',
    name_lat: 'Acer platanoides',
    plant_type: 'tree',
    crown_diameter_m: null,
    height_m: 20,
    root_system: 'shallow',
    source: `${ASSORTMENT}. Высота и корни: https://ru.wikipedia.org/wiki/Клён_остролистный`,
  },
  {
    id: 'betula_pendula',
    name_ru: 'Берёза повислая',
    name_lat: 'Betula pendula',
    plant_type: 'tree',
    crown_diameter_m: 10,
    height_m: 25,
    root_system: 'shallow',
    source: `${ASSORTMENT}. Высота, крона, корни: https://ru.wikipedia.org/wiki/Берёза_повислая`,
  },
  {
    id: 'quercus_robur',
    name_ru: 'Дуб черешчатый',
    name_lat: 'Quercus robur',
    plant_type: 'tree',
    crown_diameter_m: 20,
    height_m: 25,
    root_system: 'deep',
    source: `${ASSORTMENT} (внутриквартальные — с ограничениями). Высота, крона, корни: https://ru.wikipedia.org/wiki/Дуб_черешчатый`,
  },
  {
    id: 'sorbus_aucuparia',
    name_ru: 'Рябина обыкновенная',
    name_lat: 'Sorbus aucuparia',
    plant_type: 'tree',
    crown_diameter_m: 5.5,
    height_m: 8,
    root_system: null,
    source: `${ASSORTMENT}. Высота и крона: https://ru.wikipedia.org/wiki/Рябина_обыкновенная`,
  },
  {
    id: 'fraxinus_pennsylvanica',
    name_ru: 'Ясень пенсильванский',
    name_lat: 'Fraxinus pennsylvanica',
    plant_type: 'tree',
    crown_diameter_m: null,
    height_m: 18,
    root_system: null,
    source: `${ASSORTMENT}. Высота: https://en.wikipedia.org/wiki/Fraxinus_pennsylvanica`,
  },
  {
    id: 'ulmus_laevis',
    name_ru: 'Вяз гладкий',
    name_lat: 'Ulmus laevis',
    plant_type: 'tree',
    crown_diameter_m: null,
    height_m: 25,
    root_system: 'shallow',
    source: `${ASSORTMENT}. Высота: https://ru.wikipedia.org/wiki/Вяз_гладкий, корни: https://en.wikipedia.org/wiki/Ulmus_laevis`,
  },
  {
    id: 'aesculus_hippocastanum',
    name_ru: 'Конский каштан обыкновенный',
    name_lat: 'Aesculus hippocastanum',
    plant_type: 'tree',
    crown_diameter_m: null,
    height_m: 25,
    root_system: 'mixed',
    source: `${ASSORTMENT}. Высота и корни: https://ru.wikipedia.org/wiki/Конский_каштан_обыкновенный`,
  },
  {
    id: 'padus_maackii',
    name_ru: 'Черёмуха Маака',
    name_lat: 'Padus maackii',
    plant_type: 'tree',
    crown_diameter_m: null,
    height_m: 8,
    root_system: null,
    source: `${ASSORTMENT}. Высота: https://ru.wikipedia.org/wiki/Черёмуха_Маака`,
  },
  {
    id: 'acer_tataricum',
    name_ru: 'Клён татарский',
    name_lat: 'Acer tataricum',
    plant_type: 'tree',
    crown_diameter_m: null,
    height_m: 7,
    root_system: null,
    source: `${ASSORTMENT}. Высота: https://ru.wikipedia.org/wiki/Клён_татарский`,
  },
  {
    id: 'syringa_vulgaris',
    name_ru: 'Сирень обыкновенная',
    name_lat: 'Syringa vulgaris',
    plant_type: 'shrub',
    crown_diameter_m: null,
    height_m: 4,
    root_system: null,
    source: `${ASSORTMENT}. Высота: https://ru.wikipedia.org/wiki/Сирень_обыкновенная`,
  },
  {
    id: 'cornus_alba',
    name_ru: 'Дёрен белый',
    name_lat: 'Cornus alba',
    plant_type: 'shrub',
    crown_diameter_m: null,
    height_m: 2.5,
    root_system: null,
    source: `${ASSORTMENT}. Высота: https://ru.wikipedia.org/wiki/Дёрен_белый`,
  },
  {
    id: 'cotoneaster_lucidus',
    name_ru: 'Кизильник блестящий',
    name_lat: 'Cotoneaster lucidus',
    plant_type: 'shrub',
    crown_diameter_m: 2.5,
    height_m: 2.5,
    root_system: null,
    source: `${ASSORTMENT}. Высота: https://ru.wikipedia.org/wiki/Кизильник_блестящий, ширина: https://en.wikipedia.org/wiki/Cotoneaster_lucidus`,
  },
  {
    id: 'berberis_thunbergii',
    name_ru: 'Барбарис Тунберга',
    name_lat: 'Berberis thunbergii',
    plant_type: 'shrub',
    crown_diameter_m: null,
    height_m: 2,
    root_system: null,
    source: `${ASSORTMENT}. Высота: https://ru.wikipedia.org/wiki/Барбарис_Тунберга`,
  },
  {
    id: 'symphoricarpos_albus',
    name_ru: 'Снежноягодник белый',
    name_lat: 'Symphoricarpos albus',
    plant_type: 'shrub',
    crown_diameter_m: null,
    height_m: 1.5,
    root_system: null,
    source: `${ASSORTMENT}. Высота: https://ru.wikipedia.org/wiki/Снежноягодник_белый`,
  },
  {
    id: 'philadelphus_coronarius',
    name_ru: 'Чубушник венечный',
    name_lat: 'Philadelphus coronarius',
    plant_type: 'shrub',
    crown_diameter_m: 2,
    height_m: 2.5,
    root_system: null,
    source: `${ASSORTMENT}. Высота и крона: https://ru.wikipedia.org/wiki/Чубушник_венечный`,
  },
  {
    id: 'physocarpus_opulifolius',
    name_ru: 'Пузыреплодник калинолистный',
    name_lat: 'Physocarpus opulifolius',
    plant_type: 'shrub',
    crown_diameter_m: 4,
    height_m: 3,
    root_system: null,
    source: `${ASSORTMENT}. Высота и крона: https://ru.wikipedia.org/wiki/Пузыреплодник_калинолистный`,
  },
  {
    id: 'caragana_arborescens',
    name_ru: 'Карагана древовидная',
    name_lat: 'Caragana arborescens',
    plant_type: 'shrub',
    crown_diameter_m: null,
    height_m: 4,
    root_system: null,
    source: `${ASSORTMENT}. Высота: https://ru.wikipedia.org/wiki/Карагана_древовидная`,
  },
  {
    id: 'viburnum_opulus',
    name_ru: 'Калина обыкновенная',
    name_lat: 'Viburnum opulus',
    plant_type: 'shrub',
    crown_diameter_m: null,
    height_m: 3,
    root_system: null,
    source: `${ASSORTMENT}. Высота: https://ru.wikipedia.org/wiki/Калина_обыкновенная`,
  },
];

// Дуб в табл. В.6 для внутриквартальных посадок — «+ с огр.»: автоматически не назначается.
const RESTRICTED = new Set(['quercus_robur']);

// Как правило посадки называется в причине: «в шаг рядовой посадки 6 м».
const PLANTING_KIND: Record<string, string> = {
  TREE_ROW_CURB: 'рядовой посадки',
  TREE_FILL_LAWN: 'групповой посадки',
  SHRUB_HEDGE_CURB: 'живой изгороди',
  SHRUB_FILL_LAWN: 'групповой посадки',
};

const ASSORTMENT_REASON = 'Вид из ассортимента для внутриквартальных посадок (623-ПП, табл. В.6)';

// Правило выбора породы из contracts/species-verified.md. Причина утверждает только то, что
// правило проверило: подтверждённая крона не больше шага правила — иначе принадлежность к
// ассортименту. Кандидаты перебираются по номеру посадки, чтобы демо было разнообразным.
export function chooseSpecies(
  plantType: PlantType,
  ruleId: string,
  params: RunParams,
  index: number,
): { id: string; reason: string } {
  // Шаг — из параметров этой обработки: /runs может его изменить.
  const rule = params.rules[ruleId];
  if (rule === undefined) throw new Error(`Нет правила посадки ${ruleId}`);
  const { spacing } = rule;
  const allowed = SPECIES.filter(
    (species) => species.plant_type === plantType && !RESTRICTED.has(species.id),
  );
  const fitting = allowed.flatMap(({ id, crown_diameter_m: crown }) =>
    crown !== null && crown <= spacing ? [{ id, crown }] : [],
  );
  const fit = fitting[index % fitting.length];
  if (fit !== undefined) {
    const kind = PLANTING_KIND[ruleId] ?? 'посадки';
    return {
      id: fit.id,
      reason: `Крона около ${formatMeters(fit.crown, 1)} — вписывается в шаг ${kind} ${formatMeters(spacing, 1)}`,
    };
  }
  const species = allowed[index % allowed.length];
  if (species === undefined) throw new Error(`В справочнике нет пород типа ${plantType}`);
  return { id: species.id, reason: ASSORTMENT_REASON };
}

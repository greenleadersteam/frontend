import { formatMeters } from '@/shared/lib/format';

import type { components } from '../../generated/proposed';
import type { RunParams } from './site';

type Species = components['schemas']['Species'];
type PlantType = components['schemas']['PlantType'];

const ASSORTMENT = 'Ассортимент: 623-ПП, прил. В, табл. В.6';

// Справочник пород для демо — только из contracts/species-verified.md: ассортимент — таблица В.6
// 623-ПП, параметры — ботанические справочники; где их нет, осталась Википедия с пометкой.
// Крона и корни, которых источник не даёт, — null.
export const SPECIES: Species[] = [
  {
    id: 'tilia_cordata',
    name_ru: 'Липа мелколистная',
    name_lat: 'Tilia cordata',
    plant_type: 'tree',
    crown_diameter_m: null,
    height_m: 25,
    root_system: null,
    source: `${ASSORTMENT}. Высота: http://www.plantarium.ru/page/view/item/38502.html («Деревья и кустарники СССР», т. IV)`,
  },
  {
    id: 'acer_platanoides',
    name_ru: 'Клён остролистный',
    name_lat: 'Acer platanoides',
    plant_type: 'tree',
    crown_diameter_m: null,
    height_m: 20,
    root_system: 'shallow',
    source: `${ASSORTMENT}. Высота: http://www.plantarium.ru/page/view/item/221.html («Деревья и кустарники СССР», т. IV), корни: https://forest.jrc.ec.europa.eu/media/atlas/Acer_platanoides.pdf (European Atlas of Forest Tree Species)`,
  },
  {
    id: 'betula_pendula',
    name_ru: 'Берёза повислая',
    name_lat: 'Betula pendula',
    plant_type: 'tree',
    crown_diameter_m: 10,
    height_m: 25,
    root_system: 'shallow',
    source: `${ASSORTMENT}. Высота: http://www.agroatlas.ru/ru/content/related/Betula_pendula/ (Агроэкологический атлас России), крона и корни: https://ru.wikipedia.org/wiki/Берёза_повислая (Википедия: ботанического источника с числом не найдено)`,
  },
  {
    id: 'quercus_robur',
    name_ru: 'Дуб черешчатый',
    name_lat: 'Quercus robur',
    plant_type: 'tree',
    crown_diameter_m: 20,
    height_m: 25,
    root_system: 'deep',
    source: `${ASSORTMENT} (внутриквартальные — с ограничениями). Высота: http://www.plantarium.ru/page/view/item/31185.html («Флора СССР», т. 5), крона и корни: https://ru.wikipedia.org/wiki/Дуб_черешчатый (Википедия: ботанического источника с числом не найдено)`,
  },
  {
    id: 'sorbus_aucuparia',
    name_ru: 'Рябина обыкновенная',
    name_lat: 'Sorbus aucuparia',
    plant_type: 'tree',
    crown_diameter_m: 5.5,
    height_m: 8,
    root_system: null,
    source: `${ASSORTMENT}. Высота: http://www.agroatlas.ru/ru/content/related/Sorbus_aucuparia/ (Агроэкологический атлас России), крона: https://ru.wikipedia.org/wiki/Рябина_обыкновенная (Википедия: ботанического источника с числом не найдено)`,
  },
  {
    id: 'fraxinus_pennsylvanica',
    name_ru: 'Ясень пенсильванский',
    name_lat: 'Fraxinus pennsylvanica',
    plant_type: 'tree',
    crown_diameter_m: null,
    height_m: 18,
    root_system: null,
    source: `${ASSORTMENT}. Высота: https://research.fs.usda.gov/silvics/green-ash (Silvics of North America, Лесная служба США)`,
  },
  {
    id: 'ulmus_laevis',
    name_ru: 'Вяз гладкий',
    name_lat: 'Ulmus laevis',
    plant_type: 'tree',
    crown_diameter_m: null,
    height_m: 25,
    root_system: 'shallow',
    source: `${ASSORTMENT}. Высота: http://www.agroatlas.ru/ru/content/related/Ulmus_laevis/ (Агроэкологический атлас России), корни: https://en.wikipedia.org/wiki/Ulmus_laevis (Википедия: ботанического источника с числом не найдено)`,
  },
  {
    id: 'aesculus_hippocastanum',
    name_ru: 'Конский каштан обыкновенный',
    name_lat: 'Aesculus hippocastanum',
    plant_type: 'tree',
    crown_diameter_m: null,
    height_m: 25,
    root_system: 'mixed',
    source: `${ASSORTMENT}. Высота: https://forest.jrc.ec.europa.eu/media/atlas/Aesculus_hippocastanum.pdf (European Atlas of Forest Tree Species), корни: https://ru.wikipedia.org/wiki/Конский_каштан_обыкновенный (Википедия: ботанического источника с числом не найдено)`,
  },
  {
    id: 'padus_maackii',
    name_ru: 'Черёмуха Маака',
    name_lat: 'Padus maackii',
    plant_type: 'tree',
    crown_diameter_m: null,
    height_m: 8,
    root_system: null,
    source: `${ASSORTMENT}. Высота: http://www.agroatlas.ru/ru/content/related/Padus_maackii/ (Агроэкологический атлас России)`,
  },
  {
    id: 'acer_tataricum',
    name_ru: 'Клён татарский',
    name_lat: 'Acer tataricum',
    plant_type: 'tree',
    crown_diameter_m: null,
    height_m: 7,
    root_system: null,
    source: `${ASSORTMENT}. Высота: https://ru.wikipedia.org/wiki/Клён_татарский (Википедия: ботанического источника с числом не найдено)`,
  },
  {
    id: 'syringa_vulgaris',
    name_ru: 'Сирень обыкновенная',
    name_lat: 'Syringa vulgaris',
    plant_type: 'shrub',
    crown_diameter_m: null,
    height_m: 4,
    root_system: null,
    source: `${ASSORTMENT}. Высота: https://ru.wikipedia.org/wiki/Сирень_обыкновенная (Википедия: ботанического источника с числом не найдено)`,
  },
  {
    id: 'cornus_alba',
    name_ru: 'Дёрен белый',
    name_lat: 'Cornus alba',
    plant_type: 'shrub',
    crown_diameter_m: null,
    height_m: 2.5,
    root_system: null,
    source: `${ASSORTMENT}. Высота: http://www.plantarium.ru/page/view/item/37170.html («Сосудистые растения советского Дальнего Востока», т. 5)`,
  },
  {
    id: 'cotoneaster_lucidus',
    name_ru: 'Кизильник блестящий',
    name_lat: 'Cotoneaster lucidus',
    plant_type: 'shrub',
    crown_diameter_m: 2.5,
    height_m: 2.5,
    root_system: null,
    source: `${ASSORTMENT}. Высота: https://journal.asu.ru/bpssm/article/view/pbssm.2021024 (Ботанический сад им. А. В. Фомина, 2021), ширина: https://en.wikipedia.org/wiki/Cotoneaster_lucidus (Википедия: ботанического источника с числом не найдено)`,
  },
  {
    id: 'berberis_thunbergii',
    name_ru: 'Барбарис Тунберга',
    name_lat: 'Berberis thunbergii',
    plant_type: 'shrub',
    crown_diameter_m: null,
    height_m: 2,
    root_system: null,
    source: `${ASSORTMENT}. Высота: https://ru.wikipedia.org/wiki/Барбарис_Тунберга (Википедия: ботанического источника с числом не найдено)`,
  },
  {
    id: 'symphoricarpos_albus',
    name_ru: 'Снежноягодник белый',
    name_lat: 'Symphoricarpos albus',
    plant_type: 'shrub',
    crown_diameter_m: null,
    height_m: 1.5,
    root_system: null,
    source: `${ASSORTMENT}. Высота: https://ru.wikipedia.org/wiki/Снежноягодник_белый (Википедия: ботанического источника с числом не найдено)`,
  },
  {
    id: 'philadelphus_coronarius',
    name_ru: 'Чубушник венечный',
    name_lat: 'Philadelphus coronarius',
    plant_type: 'shrub',
    crown_diameter_m: 2,
    height_m: 2.5,
    root_system: null,
    source: `${ASSORTMENT}. Высота и крона: https://ru.wikipedia.org/wiki/Чубушник_венечный (Википедия: ботанического источника с числом не найдено)`,
  },
  {
    id: 'physocarpus_opulifolius',
    name_ru: 'Пузыреплодник калинолистный',
    name_lat: 'Physocarpus opulifolius',
    plant_type: 'shrub',
    crown_diameter_m: 4,
    height_m: 3,
    root_system: null,
    source: `${ASSORTMENT}. Высота: http://www.plantarium.ru/page/view/item/27927.html («Деревья и кустарники СССР», т. III), крона: https://ru.wikipedia.org/wiki/Пузыреплодник_калинолистный (Википедия: ботанического источника с числом не найдено)`,
  },
  {
    id: 'caragana_arborescens',
    name_ru: 'Карагана древовидная',
    name_lat: 'Caragana arborescens',
    plant_type: 'shrub',
    crown_diameter_m: null,
    height_m: 4,
    root_system: null,
    source: `${ASSORTMENT}. Высота: https://www.altzapovednik.ru/info/publikatcii/zametki-dendrologa/kargana.aspx (Алтайский биосферный заповедник, «Заметки дендролога»)`,
  },
  {
    id: 'viburnum_opulus',
    name_ru: 'Калина обыкновенная',
    name_lat: 'Viburnum opulus',
    plant_type: 'shrub',
    crown_diameter_m: null,
    height_m: 3,
    root_system: null,
    source: `${ASSORTMENT}. Высота: http://www.agroatlas.ru/ru/content/related/Viburnum_opulus/ (Агроэкологический атлас России)`,
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

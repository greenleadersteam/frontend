import type { components } from '../../generated/proposed';

type ProcessingDefaults = components['schemas']['ProcessingDefaults'];

// Правила и значения по умолчанию — ../backend/greenplan/layout/default.yaml.
// Диапазоны min/max — предложение фронтенда (contracts/openapi.proposed.yaml): отступ от борта
// не меньше нормы 743-ПП до бортового камня (0,7 м для деревьев, 0,5 м для кустарников),
// нижняя граница шага живой изгороди — реалистичные 0,3 м из комментария в default.yaml.
export const processingDefaults: ProcessingDefaults = {
  plant_types: ['tree', 'shrub'],
  planting_rules: {
    TREE_ROW_CURB: {
      name_ru: 'Рядовая/аллейная посадка вдоль борта',
      plant_type: 'tree',
      spacing_m: { default: 6, min: 4, max: 12 },
      offset_m: { default: 2.2, min: 0.7, max: 5 },
    },
    TREE_FILL_LAWN: {
      name_ru: 'Групповая/одиночная посадка на свободном газоне',
      plant_type: 'tree',
      spacing_m: { default: 5, min: 4, max: 15 },
      offset_m: null,
    },
    SHRUB_HEDGE_CURB: {
      name_ru: 'Живая изгородь вдоль борта',
      plant_type: 'shrub',
      spacing_m: { default: 1.5, min: 0.3, max: 3 },
      offset_m: { default: 0.8, min: 0.5, max: 3 },
    },
    SHRUB_FILL_LAWN: {
      name_ru: 'Групповая посадка кустарников на свободном газоне',
      plant_type: 'shrub',
      spacing_m: { default: 3, min: 1, max: 6 },
      offset_m: null,
    },
  },
};

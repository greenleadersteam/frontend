import type { components } from '../../generated/proposed';

type Schemas = components['schemas'];
type Norm = Schemas['Norm'];
type PlantType = Schemas['PlantType'];

type PerPlantType = Pick<Norm, 'basis' | 'clause' | 'text'> & { distance: number };

type NormRow = Pick<
  Norm,
  'obstacle_category' | 'obstacle_subtype' | 'citation' | 'act' | 'source_url'
> & { id: string } & Record<PlantType, PerPlantType>;

// Нормы отступов для демо. Значения и строки citation — как у бэкенда
// (../backend/greenplan/norms/default.yaml): от них строятся зоны. Акт, пункт, текст и адрес
// первоисточника — только из contracts/norms-verified.md: демо не выдумывает право. Пункт задан
// для типа посадки, только если значение сервиса для него совпадает с первоисточником; иначе
// clause — null, basis — service_default, а текст говорит, почему в акте нормы нет.
const ROWS: NormRow[] = [
  {
    id: '743-pp-gas',
    obstacle_category: 'underground_utilities',
    obstacle_subtype: 'gas',
    citation:
      '743-ПП, табл. 3.6.1 — газопровод (для кустарника норма не установлена, принято значение для дерева)',
    act: 'ПП Москвы от 10.09.2002 №\u00A0743-ПП, прил. 1',
    source_url: 'https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/',
    tree: {
      distance: 1.5,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «газопровод, канализация»',
      basis: 'regulation',
      text: 'Газопровод: дерево 1,5\u00A0м',
    },
    shrub: {
      distance: 1.5,
      clause: null,
      basis: 'service_default',
      text: 'Для кустарника у газопровода норма в ПП №\u00A0743-ПП, табл. 3.6.1, не установлена',
    },
  },
  {
    id: '743-pp-heat',
    obstacle_category: 'underground_utilities',
    obstacle_subtype: 'heat',
    citation:
      '743-ПП, табл. 3.6.1 — тепловая сеть (стенка канала, тоннеля или оболочка при бесканальной прокладке)',
    act: 'ПП Москвы от 10.09.2002 №\u00A0743-ПП, прил. 1',
    source_url: 'https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/',
    tree: {
      distance: 2,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «теплопровод, трубопровод, теплосеть»',
      basis: 'regulation',
      text: 'Теплопровод, трубопровод, теплосеть: дерево 2\u00A0м',
    },
    shrub: {
      distance: 1,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «теплопровод, трубопровод, теплосеть»',
      basis: 'regulation',
      text: 'Теплопровод, трубопровод, теплосеть: кустарник 1\u00A0м',
    },
  },
  {
    id: '743-pp-water',
    obstacle_category: 'underground_utilities',
    obstacle_subtype: 'water',
    citation:
      '743-ПП, табл. 3.6.1 — водопровод (для кустарника норма не установлена, принято значение для дерева)',
    act: 'ПП Москвы от 10.09.2002 №\u00A0743-ПП, прил. 1',
    source_url: 'https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/',
    tree: {
      distance: 2,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «водопровод, дренаж»',
      basis: 'regulation',
      text: 'Водопровод: дерево 2\u00A0м',
    },
    shrub: {
      distance: 2,
      clause: null,
      basis: 'service_default',
      text: 'Для кустарника у водопровода норма в ПП №\u00A0743-ПП, табл. 3.6.1, не установлена',
    },
  },
  {
    id: '743-pp-drainage',
    obstacle_category: 'underground_utilities',
    obstacle_subtype: 'drainage',
    citation:
      '743-ПП, табл. 3.6.1 — дренаж (для кустарника норма не установлена, принято значение для дерева)',
    act: 'ПП Москвы от 10.09.2002 №\u00A0743-ПП, прил. 1',
    source_url: 'https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/',
    tree: {
      distance: 2,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «водопровод, дренаж»',
      basis: 'regulation',
      text: 'Дренаж: дерево 2\u00A0м',
    },
    shrub: {
      distance: 2,
      clause: null,
      basis: 'service_default',
      text: 'Для кустарника у дренажа норма в ПП №\u00A0743-ПП, табл. 3.6.1, не установлена',
    },
  },
  {
    id: '743-pp-sewer',
    obstacle_category: 'underground_utilities',
    obstacle_subtype: 'sewer',
    citation:
      '743-ПП, табл. 3.6.1 — канализация (для кустарника норма не установлена, принято значение для дерева)',
    act: 'ПП Москвы от 10.09.2002 №\u00A0743-ПП, прил. 1',
    source_url: 'https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/',
    tree: {
      distance: 1.5,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «газопровод, канализация»',
      basis: 'regulation',
      text: 'Канализация: дерево 1,5\u00A0м',
    },
    shrub: {
      distance: 1.5,
      clause: null,
      basis: 'service_default',
      text: 'Для кустарника у канализации норма в ПП №\u00A0743-ПП, табл. 3.6.1, не установлена',
    },
  },
  {
    id: '743-pp-power-cable',
    obstacle_category: 'underground_utilities',
    obstacle_subtype: 'power_cable',
    citation: '743-ПП, табл. 3.6.1 — силовой кабель',
    act: 'ПП Москвы от 10.09.2002 №\u00A0743-ПП, прил. 1',
    source_url: 'https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/',
    tree: {
      distance: 2,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «силовой кабель и кабель связи»',
      basis: 'regulation',
      text: 'Силовой кабель и кабель связи: дерево 2\u00A0м',
    },
    shrub: {
      distance: 0.7,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «силовой кабель и кабель связи»',
      basis: 'regulation',
      text: 'Силовой кабель и кабель связи: кустарник 0,7\u00A0м',
    },
  },
  {
    id: '743-pp-comm-cable',
    obstacle_category: 'underground_utilities',
    obstacle_subtype: 'comm_cable',
    citation: '743-ПП, табл. 3.6.1 — кабель связи',
    act: 'ПП Москвы от 10.09.2002 №\u00A0743-ПП, прил. 1',
    source_url: 'https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/',
    tree: {
      distance: 2,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «силовой кабель и кабель связи»',
      basis: 'regulation',
      text: 'Силовой кабель и кабель связи: дерево 2\u00A0м',
    },
    shrub: {
      distance: 0.7,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «силовой кабель и кабель связи»',
      basis: 'regulation',
      text: 'Силовой кабель и кабель связи: кустарник 0,7\u00A0м',
    },
  },
  {
    id: '743-pp-other-utility',
    obstacle_category: 'underground_utilities',
    obstacle_subtype: 'other_utility',
    citation: '743-ПП, табл. 3.6.1 — неопознанная подземная сеть (консервативная норма)',
    act: 'ПП Москвы от 10.09.2002 №\u00A0743-ПП, прил. 1',
    source_url: 'https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/',
    tree: {
      distance: 2,
      clause: null,
      basis: 'service_default',
      text: 'Для неопознанной подземной сети строки в ПП №\u00A0743-ПП, табл. 3.6.1, нет',
    },
    shrub: {
      distance: 2,
      clause: null,
      basis: 'service_default',
      text: 'Для неопознанной подземной сети строки в ПП №\u00A0743-ПП, табл. 3.6.1, нет',
    },
  },
  {
    id: '743-pp-building',
    obstacle_category: 'buildings',
    obstacle_subtype: null,
    citation: '743-ПП, табл. 3.6.1 (МГСН 1.01-99) — наружная стена здания и сооружения',
    act: 'ПП Москвы от 10.09.2002 №\u00A0743-ПП, прил. 1',
    source_url: 'https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/',
    tree: {
      distance: 5,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «наружная стена здания и сооружения»',
      basis: 'regulation',
      text: 'Наружная стена здания и сооружения: дерево 5\u00A0м',
    },
    shrub: {
      distance: 1.5,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «наружная стена здания и сооружения»',
      basis: 'regulation',
      text: 'Наружная стена здания и сооружения: кустарник 1,5\u00A0м',
    },
  },
  {
    id: '743-pp-school',
    obstacle_category: 'buildings',
    obstacle_subtype: 'school_kindergarten',
    citation:
      '743-ПП, табл. 3.6.1 (МГСН 1.01-99) — наружная стена школьного здания или здания детского сада',
    act: 'ПП Москвы от 10.09.2002 №\u00A0743-ПП, прил. 1',
    source_url: 'https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/',
    tree: {
      distance: 10,
      clause:
        'п. 3.6.3, табл. 3.6.1, строка «наружная стена школьного здания и здания детского сада»',
      basis: 'regulation',
      text: 'Стена школы, детского сада: дерево 10\u00A0м',
    },
    shrub: {
      distance: 1.5,
      clause:
        'п. 3.6.3, табл. 3.6.1, строка «наружная стена школьного здания и здания детского сада»',
      basis: 'regulation',
      text: 'Стена школы, детского сада: кустарник 1,5\u00A0м',
    },
  },
  {
    id: '743-pp-road-edge',
    obstacle_category: 'road_edge',
    obstacle_subtype: null,
    citation:
      '743-ПП, табл. 3.6.1; СП 42.13330.2016, табл. 9.1 — край проезжей части улиц (бортовой камень)',
    act: 'ПП Москвы от 10.09.2002 №\u00A0743-ПП, прил. 1',
    source_url: 'https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/',
    tree: {
      distance: 2,
      clause:
        'п. 3.6.3, табл. 3.6.1, строка «край проезжей части улиц, кромка укреплённой обочины, бровка канавы»',
      basis: 'regulation',
      text: 'Край проезжей части улиц: дерево 2\u00A0м',
    },
    shrub: {
      distance: 1,
      clause:
        'п. 3.6.3, табл. 3.6.1, строка «край проезжей части улиц, кромка укреплённой обочины, бровка канавы»',
      basis: 'regulation',
      text: 'Край проезжей части улиц: кустарник 1\u00A0м',
    },
  },
  {
    id: '743-pp-footpath-edge',
    obstacle_category: 'footpath_edge',
    obstacle_subtype: null,
    citation: '743-ПП, табл. 3.6.1; СП 42.13330.2016, табл. 9.1 — край тротуара и садовой дорожки',
    act: 'ПП Москвы от 10.09.2002 №\u00A0743-ПП, прил. 1',
    source_url: 'https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/',
    tree: {
      distance: 0.7,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «край тротуара и садовой дорожки»',
      basis: 'regulation',
      text: 'Край тротуара и садовой дорожки: дерево 0,7\u00A0м',
    },
    shrub: {
      distance: 0.5,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «край тротуара и садовой дорожки»',
      basis: 'regulation',
      text: 'Край тротуара и садовой дорожки: кустарник 0,5\u00A0м',
    },
  },
  {
    id: '743-pp-poles',
    obstacle_category: 'poles_masts',
    obstacle_subtype: null,
    citation:
      '743-ПП, табл. 3.6.1; СП 42.13330.2016, табл. 9.1 — мачта и опора осветительной сети, трамвая, мостовая опора и эстакада (для кустарника норма не установлена, принято значение для дерева)',
    act: 'ПП Москвы от 10.09.2002 №\u00A0743-ПП, прил. 1',
    source_url: 'https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/',
    tree: {
      distance: 4,
      clause:
        'п. 3.6.3, табл. 3.6.1, строка «мачта и опора осветительной сети, мостовая опора и эстакада»',
      basis: 'regulation',
      text: 'Мачта и опора: дерево 4\u00A0м',
    },
    shrub: {
      distance: 4,
      clause: null,
      basis: 'service_default',
      text: 'Для кустарника у мачты и опоры норма в ПП №\u00A0743-ПП, табл. 3.6.1, не установлена',
    },
  },
  {
    id: '743-pp-slope',
    obstacle_category: 'retaining_walls_slopes',
    obstacle_subtype: 'slope',
    citation: '743-ПП, табл. 3.6.1; СП 42.13330.2016, табл. 9.1 — подошва откоса, террасы',
    act: 'ПП Москвы от 10.09.2002 №\u00A0743-ПП, прил. 1',
    source_url: 'https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/',
    tree: {
      distance: 1,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «подошва откоса, террасы и другие»',
      basis: 'regulation',
      text: 'Подошва откоса, террасы: дерево 1\u00A0м',
    },
    shrub: {
      distance: 0.5,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «подошва откоса, террасы и другие»',
      basis: 'regulation',
      text: 'Подошва откоса, террасы: кустарник 0,5\u00A0м',
    },
  },
  {
    id: '743-pp-retaining-wall',
    obstacle_category: 'retaining_walls_slopes',
    obstacle_subtype: 'retaining_wall',
    citation:
      '743-ПП, табл. 3.6.1; СП 42.13330.2016, табл. 9.1 — подошва или внутренняя грань подпорной стенки',
    act: 'ПП Москвы от 10.09.2002 №\u00A0743-ПП, прил. 1',
    source_url: 'https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/',
    tree: {
      distance: 3,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «подошва или внутренняя грань подпорной стенки»',
      basis: 'regulation',
      text: 'Подпорная стенка: дерево 3\u00A0м',
    },
    shrub: {
      distance: 1,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «подошва или внутренняя грань подпорной стенки»',
      basis: 'regulation',
      text: 'Подпорная стенка: кустарник 1\u00A0м',
    },
  },
  {
    id: '743-pp-existing-tree',
    obstacle_category: 'green_existing',
    obstacle_subtype: 'existing_tree',
    citation:
      '743-ПП, табл. 3.6.2 — расстояние между деревьями при однорядной посадке (5-6 м, принята верхняя граница)',
    act: 'ПП Москвы от 10.09.2002 №\u00A0743-ПП, прил. 1',
    source_url: 'https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/',
    tree: {
      distance: 6,
      clause: null,
      basis: 'service_default',
      text: 'Табл. 3.6.2 ПП №\u00A0743-ПП задаёт ориентировочный шаг посадки деревьев 5–6\u00A0м, а не отступ от существующего дерева',
    },
    shrub: {
      distance: 1.5,
      clause: null,
      basis: 'service_default',
      text: 'Для кустарника у существующего дерева норма в ПП №\u00A0743-ПП не установлена',
    },
  },
];

const PLANT_TYPES: readonly PlantType[] = ['tree', 'shrub'];

// Запись на пару «объект + тип посадки»: у дерева и кустарника свои значение и пункт.
export const NORMS: Norm[] = ROWS.flatMap(({ id, tree, shrub, ...row }) =>
  PLANT_TYPES.map((plantType) => {
    const { distance, ...norm } = plantType === 'tree' ? tree : shrub;
    return {
      ...row,
      ...norm,
      id: `${id}-${plantType}`,
      plant_type: plantType,
      distance_m: distance,
    };
  }),
);

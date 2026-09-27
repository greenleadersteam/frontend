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
    citation: '743-ПП — газопровод',
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
    citation: '743-ПП — тепловая сеть',
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
    citation: '743-ПП — водопровод, дренаж',
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
    citation: '743-ПП — водопровод, дренаж',
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
    citation: '743-ПП — канализация, водосток',
    act: 'ПП Москвы от 10.09.2002 №\u00A0743-ПП, прил. 1',
    source_url: 'https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/',
    tree: {
      distance: 1.5,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «газопровод, канализация»',
      basis: 'regulation',
      text: 'Канализация: дерево 1,5\u00A0м; водостока в строке нет',
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
    citation: '743-ПП — силовой кабель и кабель связи',
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
    citation: '743-ПП — силовой кабель и кабель связи',
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
    citation: '743-ПП — неопознанная подземная сеть (консервативная норма)',
    act: null,
    source_url: null,
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
    id: '743-pp-road-edge',
    obstacle_category: 'road_edge',
    obstacle_subtype: null,
    citation: '743-ПП — край тротуара/бортовой камень',
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
    id: '743-pp-existing-tree',
    obstacle_category: 'green_existing',
    obstacle_subtype: 'existing_tree',
    citation:
      '743-ПП — расстояние между озеленением, однорядная посадка (значение восстановлено из повреждённой Excel-ячейки, взята консервативная нижняя граница диапазона 5-6м)',
    act: 'ПП Москвы от 10.09.2002 №\u00A0743-ПП, прил. 1',
    source_url: 'https://base.garant.ru/378956/53f89421bbdaf741eb2d1ecc4ddb4c33/',
    tree: {
      distance: 5,
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

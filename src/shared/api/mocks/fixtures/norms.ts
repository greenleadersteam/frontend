import type { components } from '../../generated/proposed';

type Schemas = components['schemas'];
type Norm = Schemas['Norm'];
type PlantType = Schemas['PlantType'];

type PerPlantType = { distance: number; clause: string | null; text: string };

type NormRow = Pick<
  Norm,
  'obstacle_category' | 'obstacle_subtype' | 'citation' | 'act' | 'source_url'
> & { id: string } & Record<PlantType, PerPlantType>;

// Нормы отступов для демо. Значения и строки citation — как у бэкенда
// (../backend/greenplan/norms/default.yaml): от них строятся зоны. Акт, пункт, текст и адрес
// первоисточника — только из contracts/norms-verified.md: демо не выдумывает право. Пункт задан
// для типа посадки, только если значение сервиса для него совпадает с первоисточником; иначе
// clause — null, а текст говорит, что значение — решение сервиса.
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
      text: 'Газопровод: дерево 1,5\u00A0м',
    },
    shrub: {
      distance: 1.5,
      clause: null,
      text: 'Газопровод: для кустарника нормы нет, 1,5\u00A0м — консервативное значение сервиса',
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
      text: 'Теплопровод, трубопровод, теплосеть: дерево 2\u00A0м',
    },
    shrub: {
      distance: 1,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «теплопровод, трубопровод, теплосеть»',
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
      text: 'Водопровод: дерево 2\u00A0м',
    },
    shrub: {
      distance: 2,
      clause: null,
      text: 'Водопровод: для кустарника нормы нет, 2\u00A0м — консервативное значение сервиса',
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
      text: 'Дренаж: дерево 2\u00A0м',
    },
    shrub: {
      distance: 2,
      clause: null,
      text: 'Дренаж: для кустарника нормы нет, 2\u00A0м — консервативное значение сервиса',
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
      text: 'Канализация: дерево 1,5\u00A0м; водостока в строке нет',
    },
    shrub: {
      distance: 1.5,
      clause: null,
      text: 'Канализация: для кустарника нормы нет, 1,5\u00A0м — консервативное значение сервиса',
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
      text: 'Силовой кабель и кабель связи: дерево 2\u00A0м',
    },
    shrub: {
      distance: 0.7,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «силовой кабель и кабель связи»',
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
      text: 'Силовой кабель и кабель связи: дерево 2\u00A0м',
    },
    shrub: {
      distance: 0.7,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «силовой кабель и кабель связи»',
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
      text: 'Неопознанная подземная сеть: 2\u00A0м — консервативное значение сервиса, в нормативных актах строки нет',
    },
    shrub: {
      distance: 2,
      clause: null,
      text: 'Неопознанная подземная сеть: 2\u00A0м — консервативное значение сервиса, в нормативных актах строки нет',
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
      text: 'Край тротуара и садовой дорожки: дерево 0,7\u00A0м',
    },
    shrub: {
      distance: 0.5,
      clause: 'п. 3.6.3, табл. 3.6.1, строка «край тротуара и садовой дорожки»',
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
      text: 'Расстояние между деревьями при однорядной посадке 5–6\u00A0м (ориентировочно, табл. 3.6.2 — шаг посадки, а не отступ); 5\u00A0м — нижняя граница, решение сервиса',
    },
    shrub: {
      distance: 1.5,
      clause: null,
      text: 'Существующее дерево: для кустарника нормы нет, 1,5\u00A0м — значение сервиса',
    },
  },
];

const PLANT_TYPES: readonly PlantType[] = ['tree', 'shrub'];

// Запись на пару «объект + тип посадки»: у дерева и кустарника свои значение и пункт.
export const NORMS: Norm[] = ROWS.flatMap(({ id, tree, shrub, ...row }) =>
  PLANT_TYPES.map((plantType) => {
    const { distance, clause, text } = plantType === 'tree' ? tree : shrub;
    return {
      ...row,
      id: `${id}-${plantType}`,
      plant_type: plantType,
      distance_m: distance,
      clause,
      text,
    };
  }),
);

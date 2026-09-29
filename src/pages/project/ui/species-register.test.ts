import { describe, expect, test } from 'vitest';

import type { ExplanationEntry, Species } from '@/entities/project';
import type { FinalPlanting } from '@/features/edit-plantings';

import { NO_SPECIES_NOTE, speciesCsv, speciesRows, speciesTotals } from './species-register';

type Properties = FinalPlanting['features'][number]['properties'];

const feature = (properties: Partial<Properties> & Pick<Properties, 'id'>) => ({
  type: 'Feature' as const,
  geometry: { type: 'Point' as const, coordinates: [0, 0] },
  properties: {
    plant_type: 'tree' as const,
    rule_id: 'TREE_ROW_CURB',
    species_id: null,
    origin: 'auto' as const,
    moved_from: null,
    species_changed: false,
    ...properties,
  },
});

const planting: FinalPlanting = {
  type: 'FeatureCollection',
  metadata: { crs: 'EPSG:4326' },
  features: [
    feature({ id: 'T-1', species_id: 'tilia_cordata' }),
    feature({ id: 'T-2', species_id: 'tilia_cordata' }),
    feature({ id: 'T-3', species_id: 'sorbus_aucuparia' }),
    feature({ id: 'S-1', plant_type: 'shrub', rule_id: 'SHRUB_HEDGE_CURB' }),
    feature({ id: 'manual-1', plant_type: 'shrub', rule_id: null, origin: 'manual' }),
  ],
};

const species = new Map<string, Species>(
  [
    ['tilia_cordata', 'Липа мелколистная', 'Tilia cordata'],
    ['sorbus_aucuparia', 'Рябина обыкновенная', 'Sorbus aucuparia'],
  ].map(([id = '', ru = '', lat = '']) => [
    id,
    {
      id,
      name_ru: ru,
      name_lat: lat,
      plant_type: 'tree',
      crown_diameter_m: null,
      height_m: 10,
      root_system: null,
      source: '',
    },
  ]),
);

const explanation = new Map<string, ExplanationEntry>([
  [
    'S-1',
    {
      id: 'S-1',
      plant_type: 'shrub',
      rule_id: 'SHRUB_HEDGE_CURB',
      rule_name_ru: 'Живая изгородь вдоль борта',
      x: 0,
      y: 0,
    },
  ],
]);

describe('ведомость озеленения', () => {
  test('по породам, без породы — по правилу с примечанием; деревья сначала, по убыванию', () => {
    expect(speciesRows(planting, species, explanation)).toMatchObject([
      { nameRu: 'Липа мелколистная', nameLat: 'Tilia cordata', count: 2, note: '' },
      { nameRu: 'Рябина обыкновенная', count: 1 },
      { nameRu: 'Добавлены вручную', plantType: 'shrub', count: 1, note: NO_SPECIES_NOTE },
      { nameRu: 'Живая изгородь вдоль борта', plantType: 'shrub', note: NO_SPECIES_NOTE },
    ]);
  });

  test('без справочника пород — только правила посадки', () => {
    const rows = speciesRows(planting, new Map(), explanation);

    expect(rows.every(({ note }) => note === NO_SPECIES_NOTE)).toBe(true);
    expect(rows[0]).toMatchObject({ nameRu: 'Дерево, правило TREE_ROW_CURB', count: 3 });
    expect(speciesTotals(rows)).toEqual({ tree: 3, shrub: 2 });
  });

  test('CSV: BOM, «;», итоги по типам, защита от формул', () => {
    const rows = speciesRows(
      { ...planting, features: [feature({ id: 'X' })] },
      new Map(),
      new Map([
        [
          'X',
          {
            id: 'X',
            plant_type: 'tree',
            rule_id: 'R',
            rule_name_ru: '=HYPERLINK("x")',
            x: 0,
            y: 0,
          },
        ],
      ]),
    );
    const lines = speciesCsv(rows).split('\r\n');

    expect(lines[0]).toBe(
      '\uFEFF№ п/п;Наименование;Латинское наименование;Тип;Количество, шт.;Примечание',
    );
    // Название правила — данные сервера: апостроф перед «=», кавычки — по RFC 4180.
    expect(lines[1]).toBe(`1;"'=HYPERLINK(""x"")";;Дерево;1;${NO_SPECIES_NOTE}`);
    expect(lines.slice(2, 4)).toEqual([';Итого деревьев;;;1;', ';Итого кустарников;;;0;']);
  });
});

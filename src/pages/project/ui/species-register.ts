import {
  type ExplanationEntry,
  PLANT_TYPE_LABELS,
  type PlantType,
  type Species,
} from '@/entities/project';
import type { FinalPlanting } from '@/features/edit-plantings';

import { csvDocument, textCell } from './register-csv';

// Строка ведомости озеленения: порода или, без неё, правило посадки.
export type SpeciesRow = {
  key: string;
  nameRu: string;
  nameLat: string | null;
  plantType: PlantType;
  count: number;
  note: string;
};

type SpeciesTotals = Record<PlantType, number>;

export const NO_SPECIES_NOTE = 'Порода не определена сервисом';
const MANUAL_NAME = 'Добавлены вручную';

const TYPE_ORDER: Record<PlantType, number> = { tree: 0, shrub: 1 };
const collator = new Intl.Collator('ru-RU', { numeric: true });

// Ведомость озеленения по итоговой расстановке: посадки с породой из справочника — по породам,
// остальные — по правилам посадки с примечанием, что породы нет. Сначала деревья, внутри
// типа — по убыванию числа.
export function speciesRows(
  planting: FinalPlanting,
  species: ReadonlyMap<string, Species>,
  explanation: ReadonlyMap<string, ExplanationEntry>,
): SpeciesRow[] {
  const rows = new Map<string, SpeciesRow>();
  for (const { properties } of planting.features) {
    const known = properties.species_id == null ? undefined : species.get(properties.species_id);
    const key =
      known === undefined
        ? `rule|${properties.plant_type}|${properties.rule_id}`
        : `species|${known.id}`;
    const row = rows.get(key);
    if (row !== undefined) {
      row.count += 1;
      continue;
    }
    rows.set(
      key,
      known === undefined
        ? {
            key,
            nameRu:
              properties.origin === 'manual'
                ? MANUAL_NAME
                : (explanation.get(properties.id)?.rule_name_ru ??
                  `${PLANT_TYPE_LABELS[properties.plant_type]}, правило ${properties.rule_id}`),
            nameLat: null,
            plantType: properties.plant_type,
            count: 1,
            note: NO_SPECIES_NOTE,
          }
        : {
            key,
            nameRu: known.name_ru,
            nameLat: known.name_lat,
            plantType: known.plant_type,
            count: 1,
            note: '',
          },
    );
  }
  return [...rows.values()].sort(
    (a, b) =>
      TYPE_ORDER[a.plantType] - TYPE_ORDER[b.plantType] ||
      b.count - a.count ||
      collator.compare(a.nameRu, b.nameRu),
  );
}

export const speciesTotals = (rows: readonly SpeciesRow[]): SpeciesTotals => ({
  tree: rows.reduce((sum, row) => sum + (row.plantType === 'tree' ? row.count : 0), 0),
  shrub: rows.reduce((sum, row) => sum + (row.plantType === 'shrub' ? row.count : 0), 0),
});

export const TOTAL_LABELS = {
  tree: 'Итого деревьев',
  shrub: 'Итого кустарников',
} as const satisfies Record<PlantType, string>;

// Та же ведомость в CSV: те же правила, что у ведомости посадок (BOM, «;», защита от формул).
export function speciesCsv(rows: readonly SpeciesRow[]): string {
  const totals = speciesTotals(rows);
  return csvDocument(
    ['№ п/п', 'Наименование', 'Латинское наименование', 'Тип', 'Количество, шт.', 'Примечание'],
    [
      ...rows.map((row, index) => [
        String(index + 1),
        textCell(row.nameRu),
        textCell(row.nameLat ?? ''),
        textCell(PLANT_TYPE_LABELS[row.plantType]),
        String(row.count),
        textCell(row.note),
      ]),
      ...(['tree', 'shrub'] as const).map((plantType) => [
        '',
        textCell(TOTAL_LABELS[plantType]),
        '',
        '',
        String(totals[plantType]),
        '',
      ]),
    ],
  );
}

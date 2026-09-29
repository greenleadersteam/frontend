import { PLANT_TYPE_LABELS } from '@/entities/project';
import type { XlsxSheet } from '@/shared/lib/xlsx';

import { type RegisterRow, SOURCE_LABELS, STATUS_LABELS } from './register-csv';
import { type SpeciesRow, speciesTotals, TOTAL_LABELS } from './species-register';

// Точность — как в таблице и CSV: широта и долгота до ~0,1 м, координаты чертежа до сантиметра.
const round = (value: number | null, digits: number): number | null =>
  value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;

// Ведомость посадок для Excel: те же колонки, что в CSV, числа — числами. Итоги — по типам,
// подпись рядом с числом.
export function registerSheet(rows: RegisterRow[], edited: boolean): XlsxSheet {
  const withGeo = rows.some(({ lat }) => lat !== null);
  const withDrawing = rows.some(({ x }) => x !== null);
  const count = (plantType: RegisterRow['plantType']) =>
    rows.filter((row) => row.plantType === plantType).length;
  return {
    name: 'Ведомость посадок',
    header: [
      '№',
      'Идентификатор',
      'Тип',
      'Правило посадки',
      ...(edited ? ['Статус', 'Источник'] : []),
      ...(withGeo ? ['Широта', 'Долгота'] : []),
      ...(withDrawing ? ['X чертежа, м', 'Y чертежа, м'] : []),
    ],
    rows: rows.map((row) => [
      row.number,
      row.id,
      PLANT_TYPE_LABELS[row.plantType],
      row.ruleName,
      ...(edited ? [STATUS_LABELS[row.status], SOURCE_LABELS[row.source]] : []),
      ...(withGeo ? [round(row.lat, 6), round(row.lon, 6)] : []),
      ...(withDrawing ? [round(row.x, 2), round(row.y, 2)] : []),
    ]),
    totals: (['tree', 'shrub'] as const).map((plantType) => [
      null,
      TOTAL_LABELS[plantType],
      count(plantType),
    ]),
  };
}

// Ведомость озеленения для Excel: как таблица «По породам», итоги по типам.
export function speciesSheet(rows: readonly SpeciesRow[]): XlsxSheet {
  const totals = speciesTotals(rows);
  return {
    name: 'Ведомость озеленения',
    header: [
      '№ п/п',
      'Наименование',
      'Латинское наименование',
      'Тип',
      'Количество, шт.',
      'Примечание',
    ],
    rows: rows.map((row, index) => [
      index + 1,
      row.nameRu,
      row.nameLat,
      PLANT_TYPE_LABELS[row.plantType],
      row.count,
      row.note,
    ]),
    totals: (['tree', 'shrub'] as const).map((plantType) => [
      null,
      TOTAL_LABELS[plantType],
      null,
      null,
      totals[plantType],
      null,
    ]),
  };
}

import { type ExplanationEntry, PLANT_TYPE_LABELS, type PlantingStatus } from '@/entities/project';
import type { FinalPlanting } from '@/features/edit-plantings';
import { formatCoordinate, formatDrawingCoordinate } from '@/shared/lib/format';

export type PlantingSource = 'service' | 'moved' | 'added';

export const STATUS_LABELS = {
  allowed: 'Соответствует нормам',
  forbidden: 'Нарушает норму',
  rejected: 'Вне разрешённой области',
} satisfies Record<PlantingStatus, string>;

export const SOURCE_LABELS = {
  service: 'сервис',
  moved: 'перемещена',
  added: 'добавлена',
} satisfies Record<PlantingSource, string>;

export type RegisterRow = {
  number: number;
  id: string;
  plantType: 'tree' | 'shrub';
  ruleName: string | null;
  status: PlantingStatus;
  source: PlantingSource;
  // Перемещена, добавлена или сменена порода: фильтр «Только изменённые».
  changed: boolean;
  // WGS84 — только у проекта с геопривязкой.
  lat: number | null;
  lon: number | null;
  // Координаты чертежа из /explanation, если он пришёл.
  x: number | null;
  y: number | null;
};

// Строки ведомости по итоговой расстановке: в порядке /planting, добавленные — в конце.
// Название правила и координаты чертежа — из /explanation; у перемещённых и добавленных
// координаты чертежа — свои, если план в метрах чертежа, и неизвестны при геопривязке.
export function registerRows(
  planting: FinalPlanting,
  explanation: ReadonlyMap<string, ExplanationEntry>,
  geographic: boolean,
  statuses: ReadonlyMap<string, PlantingStatus>,
): RegisterRow[] {
  return planting.features.map(({ geometry, properties }, index) => {
    const entry = explanation.get(properties.id);
    const source: PlantingSource =
      properties.origin === 'manual'
        ? 'added'
        : properties.moved_from === null
          ? 'service'
          : 'moved';
    const [lon = null, lat = null] = geographic ? geometry.coordinates : [];
    const [x = null, y = null] =
      source === 'service' ? [entry?.x, entry?.y] : geographic ? [] : geometry.coordinates;
    return {
      number: index + 1,
      id: properties.id,
      plantType: properties.plant_type,
      ruleName: entry?.rule_name_ru ?? null,
      status: statuses.get(properties.id) ?? 'allowed',
      source,
      changed: source !== 'service' || properties.species_changed,
      lat,
      lon,
      x,
      y,
    };
  });
}

// Начало ячейки, которое Excel и LibreOffice исполнят как формулу (CSV injection, OWASP).
const FORMULA_START = /^[=+\-@\t\r]/;

// Текстовая ячейка: защита от формул и экранирование по RFC 4180.
export function textCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

// Число прошло через Intl.NumberFormat: на выходе только цифры, минус и запятая, формулой
// ячейка быть не может. Форматтеры те же, что в таблице: запятая для русского Excel.
const numberCell = (value: number | null, format: (value: number) => string) =>
  value === null ? '' : format(value);

// CSV для русского Excel: UTF-8 с BOM (иначе кириллица без мастера импорта не читается),
// разделитель «;», строки через CRLF (RFC 4180). Ячейки строк уже подготовлены: текст — через
// textCell, числа — через Intl.
export const csvDocument = (header: string[], lines: string[][]): string =>
  `\uFEFF${[header.map(textCell), ...lines].map((cells) => cells.join(';')).join('\r\n')}\r\n`;

// Ведомость посадок, десятичная запятая. Статус и источник — только когда есть правки,
// как в таблице.
export function registerCsv(rows: RegisterRow[], edited: boolean): string {
  const withGeo = rows.some(({ lat }) => lat !== null);
  const withDrawing = rows.some(({ x }) => x !== null);
  const header = [
    '№',
    'Идентификатор',
    'Тип',
    'Правило посадки',
    ...(edited ? ['Статус', 'Источник'] : []),
    ...(withGeo ? ['Широта', 'Долгота'] : []),
    ...(withDrawing ? ['X чертежа, м', 'Y чертежа, м'] : []),
  ];
  const lines = rows.map((row) => [
    String(row.number),
    textCell(row.id),
    textCell(PLANT_TYPE_LABELS[row.plantType]),
    textCell(row.ruleName ?? ''),
    ...(edited ? [textCell(STATUS_LABELS[row.status]), textCell(SOURCE_LABELS[row.source])] : []),
    ...(withGeo
      ? [numberCell(row.lat, formatCoordinate), numberCell(row.lon, formatCoordinate)]
      : []),
    ...(withDrawing
      ? [numberCell(row.x, formatDrawingCoordinate), numberCell(row.y, formatDrawingCoordinate)]
      : []),
  ]);
  return csvDocument(header, lines);
}

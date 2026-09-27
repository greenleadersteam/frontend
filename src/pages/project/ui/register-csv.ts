import {
  type ExplanationEntry,
  PLANT_TYPE_LABELS,
  type PlantingFeatureCollection,
} from '@/entities/project';
import { formatCoordinate, formatDrawingCoordinate } from '@/shared/lib/format';

export type RegisterRow = {
  number: number;
  id: string;
  plantType: 'tree' | 'shrub';
  ruleName: string | null;
  // WGS84 — только у проекта с геопривязкой.
  lat: number | null;
  lon: number | null;
  // Координаты чертежа из /explanation, если он пришёл.
  x: number | null;
  y: number | null;
};

// Строки ведомости в порядке /planting; название правила и координаты чертежа — из /explanation.
export function registerRows(
  planting: PlantingFeatureCollection,
  explanation: ReadonlyMap<string, ExplanationEntry>,
  geographic: boolean,
): RegisterRow[] {
  return planting.features.map(({ geometry, properties }, index) => {
    const entry = explanation.get(properties.id);
    const [lon = null, lat = null] = geographic ? geometry.coordinates : [];
    return {
      number: index + 1,
      id: properties.id,
      plantType: properties.plant_type,
      ruleName: entry?.rule_name_ru ?? null,
      lat,
      lon,
      x: entry?.x ?? null,
      y: entry?.y ?? null,
    };
  });
}

// Начало ячейки, которое Excel и LibreOffice исполнят как формулу (CSV injection, OWASP).
const FORMULA_START = /^[=+\-@\t\r]/;

// Текстовая ячейка: защита от формул и экранирование по RFC 4180.
function textCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

// Число прошло через Intl.NumberFormat: на выходе только цифры, минус и запятая, формулой
// ячейка быть не может. Форматтеры те же, что в таблице: запятая для русского Excel.
const numberCell = (value: number | null, format: (value: number) => string) =>
  value === null ? '' : format(value);

// Ведомость для русского Excel: UTF-8 с BOM (иначе кириллица без мастера импорта не читается),
// разделитель «;», десятичная запятая, строки через CRLF (RFC 4180).
export function registerCsv(rows: RegisterRow[]): string {
  const withGeo = rows.some(({ lat }) => lat !== null);
  const withDrawing = rows.some(({ x }) => x !== null);
  const header = [
    '№',
    'Идентификатор',
    'Тип',
    'Правило посадки',
    ...(withGeo ? ['Широта', 'Долгота'] : []),
    ...(withDrawing ? ['X чертежа, м', 'Y чертежа, м'] : []),
  ];
  const lines = rows.map((row) =>
    [
      String(row.number),
      textCell(row.id),
      textCell(PLANT_TYPE_LABELS[row.plantType]),
      textCell(row.ruleName ?? ''),
      ...(withGeo
        ? [numberCell(row.lat, formatCoordinate), numberCell(row.lon, formatCoordinate)]
        : []),
      ...(withDrawing
        ? [numberCell(row.x, formatDrawingCoordinate), numberCell(row.y, formatDrawingCoordinate)]
        : []),
    ].join(';'),
  );
  return `\uFEFF${[header.map(textCell).join(';'), ...lines].join('\r\n')}\r\n`;
}

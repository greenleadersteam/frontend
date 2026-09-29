import type { PlantType } from '../model/project';
import { CROWN_RADIUS_M } from './plan-projection';

// Слой и имя приложения XDATA — как у бэкенда (../backend/greenplan/io/dxf_sink.py:22-23),
// чтобы слой с правками читался теми же инструментами, что и результат сервиса.
export const PLANTING_LAYER = 'GREENING_PROPOSED';
export const XDATA_APPID = 'GREENPLAN';
// Цвет слоя — как у бэкенда: 3, зелёный (dxf_sink.py:88).
const LAYER_COLOR = 3;
// $INSUNITS: 6 — метры.
const UNITS_METERS = 6;

export type DxfPlanting = {
  // Центр в координатах чертежа, метры.
  x: number;
  y: number;
  plantType: PlantType;
  // null — добавлена вручную: правила у неё нет.
  ruleId: string | null;
  id: string;
  origin: 'auto' | 'manual';
  status: string;
  speciesId: string | null;
};

// Строки DXF R12 — в кодовой странице чертежа, а значения пришли с сервера: всё, кроме
// печатного ASCII, заменяется. Перевод строки иначе разорвал бы пару «код — значение» и
// сдвинул бы весь файл. 255 — предел строки XDATA.
export const safeText = (value: string): string =>
  value.replace(/[^\x20-\x7E]/g, '_').slice(0, 255);

// Десятая доля миллиметра; без экспоненты, которую понимают не все читатели DXF.
const number = (value: number) => value.toFixed(4);

const pairs = (...items: (string | number)[][]) =>
  items.map(([code, value]) => `${String(code)}\r\n${String(value)}`).join('\r\n');

// Отдельный слой посадок в DXF R12 (AC1009): HEADER, TABLES (тип линии, слой, APPID)
// и ENTITIES с окружностями. XDATA — те же поля, что у бэкенда (тип, правило, id), и дальше
// происхождение, статус и порода, если она есть (dxf_sink.py:99).
export function plantingLayerDxf(plantings: readonly DxfPlanting[]): string {
  const header = pairs(
    [0, 'SECTION'],
    [2, 'HEADER'],
    [9, '$ACADVER'],
    [1, 'AC1009'],
    [9, '$INSUNITS'],
    [70, UNITS_METERS],
    [0, 'ENDSEC'],
  );
  const tables = pairs(
    [0, 'SECTION'],
    [2, 'TABLES'],
    [0, 'TABLE'],
    [2, 'LTYPE'],
    [70, 1],
    [0, 'LTYPE'],
    [2, 'CONTINUOUS'],
    [70, 0],
    [3, 'Solid line'],
    [72, 65],
    [73, 0],
    [40, '0.0'],
    [0, 'ENDTAB'],
    [0, 'TABLE'],
    [2, 'LAYER'],
    [70, 1],
    [0, 'LAYER'],
    [2, PLANTING_LAYER],
    [70, 0],
    [62, LAYER_COLOR],
    [6, 'CONTINUOUS'],
    [0, 'ENDTAB'],
    [0, 'TABLE'],
    [2, 'APPID'],
    [70, 1],
    [0, 'APPID'],
    [2, XDATA_APPID],
    [70, 0],
    [0, 'ENDTAB'],
    [0, 'ENDSEC'],
  );
  const circles = plantings.map((planting) =>
    pairs(
      [0, 'CIRCLE'],
      [8, PLANTING_LAYER],
      [10, number(planting.x)],
      [20, number(planting.y)],
      [30, '0.0'],
      [40, number(CROWN_RADIUS_M[planting.plantType])],
      [1001, XDATA_APPID],
      [1000, planting.plantType],
      // XDATA позиционная: пустая строка держит место правила.
      [1000, safeText(planting.ruleId ?? '')],
      [1000, safeText(planting.id)],
      [1000, planting.origin],
      [1000, safeText(planting.status)],
      ...(planting.speciesId === null ? [] : [[1000, safeText(planting.speciesId)]]),
    ),
  );
  const entities = [pairs([0, 'SECTION'], [2, 'ENTITIES']), ...circles, pairs([0, 'ENDSEC'])];
  return `${[header, tables, ...entities, pairs([0, 'EOF'])].join('\r\n')}\r\n`;
}

import type { components } from '../../generated/proposed';

type Schemas = components['schemas'];
type Obstacle = Schemas['ObstacleFeature'];

// Радиусы кроны на слое результата — как у бэкенда: ../backend/greenplan/io/dxf_sink.py:20-21.
const CROWN_RADIUS_M = { tree: 1.5, shrub: 0.35 } as const;
const PLANTING_LAYER = 'GREENING_PROPOSED';
const TEXT_LAYER = 'Надписи';

export type ResultPlanting = {
  x: number;
  y: number;
  plantType: keyof typeof CROWN_RADIUS_M;
  ruleId: string | null;
  id: string;
};

// Кириллица в кодовой странице чертежа R12 ($DWGCODEPAGE ANSI_1251): А–я — 0xC0–0xFF, Ё и ё
// отдельно. Другого, кроме ASCII, в демо-чертеже нет.
function cp1251(text: string): number[] {
  return Array.from({ length: text.length }, (_, index) => {
    const code = text.charCodeAt(index);
    if (code < 0x80) return code;
    if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0;
    if (code === 0x401) return 0xa8;
    if (code === 0x451) return 0xb8;
    return 0x3f;
  });
}

const number = (value: number) => value.toFixed(4);

// Демо-чертёж — копия подосновы со слоем результата, как отдаёт сервер: DXF R12, объекты
// подосновы на своих слоях (кириллица в cp1251), подпись, таблицы слоёв и приложений, окружности
// результата с XDATA «тип, правило, id» (../backend/greenplan/io/dxf_sink.py:87-100). Handle нет:
// R12 их не требует. Координаты — метры чертежа.
export function siteDxf(
  obstacles: readonly Obstacle[],
  plantings: readonly ResultPlanting[],
): Uint8Array {
  const pairs: [number, string | number][] = [];
  const add = (...items: [number, string | number][]) => pairs.push(...items);
  const layers = [...new Set(obstacles.map(({ properties }) => properties.layer))];
  const polyline = (layer: string, points: number[][], closed: boolean) => {
    add([0, 'POLYLINE'], [8, layer], [66, 1], [10, '0.0'], [20, '0.0'], [30, '0.0']);
    add([70, closed ? 1 : 0]);
    for (const [x = 0, y = 0] of points) {
      add([0, 'VERTEX'], [8, layer], [10, number(x)], [20, number(y)], [30, '0.0']);
    }
    add([0, 'SEQEND'], [8, layer]);
  };

  add(
    [0, 'SECTION'],
    [2, 'HEADER'],
    [9, '$ACADVER'],
    [1, 'AC1009'],
    [9, '$DWGCODEPAGE'],
    [3, 'ANSI_1251'],
  );
  add([9, '$INSBASE'], [10, '0.0'], [20, '0.0'], [30, '0.0'], [0, 'ENDSEC']);

  add([0, 'SECTION'], [2, 'TABLES']);
  add([0, 'TABLE'], [2, 'LTYPE'], [70, 1]);
  add([0, 'LTYPE'], [2, 'CONTINUOUS'], [70, 0], [3, 'Solid line'], [72, 65], [73, 0], [40, '0.0']);
  add([0, 'ENDTAB']);
  add([0, 'TABLE'], [2, 'LAYER'], [70, layers.length + 3]);
  for (const [name, color] of [
    ['0', 7],
    ...layers.map((name) => [name, 8] as const),
    [TEXT_LAYER, 7],
    [PLANTING_LAYER, 3],
  ] as const) {
    add([0, 'LAYER'], [2, name], [70, 0], [62, color], [6, 'CONTINUOUS']);
  }
  add([0, 'ENDTAB']);
  add([0, 'TABLE'], [2, 'STYLE'], [70, 1]);
  add([0, 'STYLE'], [2, 'STANDARD'], [70, 0], [40, '0.0'], [41, '1.0'], [50, '0.0'], [71, 0]);
  add([42, '2.5'], [3, 'txt'], [4, '']);
  add([0, 'ENDTAB']);
  add([0, 'TABLE'], [2, 'APPID'], [70, 2]);
  add([0, 'APPID'], [2, 'ACAD'], [70, 0], [0, 'APPID'], [2, 'GREENPLAN'], [70, 0]);
  add([0, 'ENDTAB'], [0, 'ENDSEC']);

  add([0, 'SECTION'], [2, 'BLOCKS'], [0, 'ENDSEC']);

  add([0, 'SECTION'], [2, 'ENTITIES']);
  for (const { geometry, properties } of obstacles) {
    const layer = properties.layer;
    switch (geometry.type) {
      case 'Point': {
        const [x = 0, y = 0] = geometry.coordinates;
        add([0, 'POINT'], [8, layer], [10, number(x)], [20, number(y)], [30, '0.0']);
        break;
      }
      case 'LineString':
        polyline(layer, geometry.coordinates, false);
        break;
      case 'MultiLineString':
        for (const line of geometry.coordinates) polyline(layer, line, false);
        break;
      case 'Polygon':
        for (const ring of geometry.coordinates) polyline(layer, ring.slice(0, -1), true);
        break;
      case 'MultiPolygon':
        for (const ring of geometry.coordinates.flat()) polyline(layer, ring.slice(0, -1), true);
        break;
      default: {
        const unexpected: never = geometry;
        return unexpected;
      }
    }
  }
  add(
    [0, 'TEXT'],
    [8, TEXT_LAYER],
    [10, '0.0'],
    [20, '-6.0'],
    [30, '0.0'],
    [40, '1.0'],
    [1, 'Демонстрационный участок, сквер'],
  );
  for (const { x, y, plantType, ruleId, id } of plantings) {
    add([0, 'CIRCLE'], [8, PLANTING_LAYER], [10, number(x)], [20, number(y)], [30, '0.0']);
    add([40, String(CROWN_RADIUS_M[plantType])], [1001, 'GREENPLAN'], [1000, plantType]);
    add([1000, ruleId ?? ''], [1000, id]);
  }
  add([0, 'ENDSEC'], [0, 'EOF']);

  return Uint8Array.from(
    pairs.flatMap(([code, value]) =>
      cp1251(`${String(code).padStart(3, ' ')}\r\n${String(value)}\r\n`),
    ),
  );
}

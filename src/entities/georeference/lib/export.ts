import type { Unit } from '@/shared/lib/contour';
import { UNITS } from '@/shared/lib/contour';
import { enuFrame, fitSimilarity, toMercator, WGS84 } from '@/shared/lib/geodesy';
import type { GcpPair, Placement, WorkScale } from '@/shared/lib/georeference';
import {
  azimuthY,
  expectedError,
  frameOf,
  normalizeAngle,
  sizeOnMap,
  stats,
  VERDICT_TEXT,
  vertexLatLon,
} from '@/shared/lib/georeference';

// Выгрузка результата привязки: JSON с параметрами и каталогом, CSV-каталог, geojson в WGS 84.
// Перенесено из прототипа ../geojson/js/export.js без изменений форматов. Добавлена самопроверка
// замыкания круга: прототип делал её только в проверках, здесь без неё выгрузки нет.

export const LL_DIGITS = 9; // градусы: 1e−9° ≈ 0,1 мм
export const M_DIGITS = 4; // метры: 0,1 мм

export type GeoreferenceState = Placement & { gcp: readonly GcpPair[]; workScale: WorkScale };

export function roundTo(value: number, digits: number): number | null {
  if (!Number.isFinite(value)) return null;
  const f = 10 ** digits;
  const r = Math.round(value * f) / f;
  return r === 0 ? 0 : r; // без минус-нуля
}

const pad = (n: number): string => String(n).padStart(2, '0');

// Местное время с указанием сдвига: выгрузку потом сверяют с журналом.
export function exportStamp(date: Date): { iso: string; file: string } {
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '−';
  const day = `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return {
    iso:
      `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
      ` UTC${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`,
    file: `${day}_${pad(date.getHours())}${pad(date.getMinutes())}`,
  };
}

const baseName = (name: string): string =>
  (name === '' ? 'контур' : name).replace(/\.[^.]+$/, '').replace(/\s+/g, '-');

export const fileName = (sourceName: string, suffix: string, ext: string, date: Date): string =>
  `${baseName(sourceName)}_привязка_${exportStamp(date).file}${suffix}.${ext}`;

export type CatalogRow = {
  номер: number;
  x: number | null;
  y: number | null;
  широта: number | null;
  долгота: number | null;
  x_3857: number | null;
  y_3857: number | null;
  полигон: number;
  кольцо: number;
  вершина: number;
};

export type ExportData = {
  файл: string;
  создано: string;
  параметры_трансформирования: {
    модель: string;
    опорная_точка_wgs84: { широта: number | null; долгота: number | null };
    опорная_точка_в_координатах_файла: { x: number | null; y: number | null };
    поворот_против_часовой_градусы: number | null;
    азимут_оси_y_градусы: number | null;
    масштаб_метров_в_единице_файла: number;
    эллипсоид: { имя: string; большая_полуось_м: number; обратное_уплощение: number };
    как_применять: string;
  };
  каталог_координат: CatalogRow[];
  опорные_точки: {
    номер: number;
    x: number | null;
    y: number | null;
    широта: number | null;
    долгота: number | null;
    учитывается: boolean;
    контрольная: boolean;
    dN: number | null;
    dE: number | null;
    dS: number | null;
  }[];
  оценка_точности: {
    rms_м: number | null;
    наибольшая_невязка_м: number | null;
    rms_по_контрольным_м: number | null;
    масштаб_работ: string;
    допуск_м: number | null;
    вердикт: string;
    учтённых_точек: number;
    контрольных_точек: number;
    примечание: string;
  };
  оценка_модели: {
    радиус_площадки_м: number | null;
    ожидаемая_погрешность_касательной_плоскости_м: number | null;
    примечание: string;
  };
  gcp_gdal_translate: string;
};

// Самопроверка: подобие подгоняется обратно по парам координат из самой выгрузки, а не по
// состоянию приложения, и должно вернуть заданные параметры. Пороги прототипа («Замыкание
// круга») — масштаб 1e−6, угол 1e−4° — годятся для участка от сотни метров. Выгрузка округляет
// широту и долготу до 1e−9°, то есть до 0,1 мм, и на участке в 10–40 м одно это округление
// сбивает масштаб и угол сильнее: самопроверка отказывала без ошибки в привязке (замер Г1: 33 %
// отказов на 20 м). Поэтому допуск масштаба и угла — не строже 2·10⁻⁴ м на большую сторону
// участка на местности; угол — тот же допуск на сторону в радианах, переведённый в градусы.
// RMS остаётся абсолютным: 1 мм.
const ROUND_TRIP_SCALE = 1e-6; // относительная разница масштаба
const ROUND_TRIP_ANGLE = 1e-4; // градуса
const ROUND_TRIP_SIDE_TOLERANCE = 2e-4; // м на большую сторону
const ROUND_TRIP_RMS = 1e-3; // м

export type RoundTrip = { scaleRel: number; rotation: number; rms: number };
export type ExportError = { kind: 'RoundTripFailed'; roundTrip: RoundTrip | null };
export type ExportResult<T> = { ok: true; value: T } | { ok: false; error: ExportError };

// Отказ самопроверки — ошибка вычислений, а не пользователя: текст не отправляет проверять
// масштаб и положение, которые пользователь задал сам.
export const EXPORT_ERROR_TEXT =
  'Выгрузка не прошла самопроверку: координаты в файле не восстанавливают привязку с точностью ' +
  'выгрузки. Файл не сохранён. Сообщите разработчикам, указав размер участка и поворот.';

export function roundTrip(data: ExportData): RoundTrip | null {
  const p = data.параметры_трансформирования;
  const lat = p.опорная_точка_wgs84.широта;
  const lon = p.опорная_точка_wgs84.долгота;
  const rotation = p.поворот_против_часовой_градусы;
  if (lat === null || lon === null || rotation === null) return null;
  const frame = enuFrame({ lat, lon });
  const src = [];
  const dst = [];
  for (const row of data.каталог_координат) {
    if (row.x === null || row.y === null || row.широта === null || row.долгота === null)
      return null;
    src.push({ x: row.x, y: row.y });
    const { e, n } = frame.toEnu({ lat: row.широта, lon: row.долгота, h: 0 });
    dst.push({ x: e, y: n });
  }
  const fit = fitSimilarity(src, dst);
  if (fit === null) return null;
  return {
    scaleRel: fit.scale / p.масштаб_метров_в_единице_файла - 1,
    rotation: normalizeAngle(fit.rotationDeg - rotation),
    rms: fit.rms,
  };
}

// Допуски самопроверки для участка с большей стороной side метров на местности.
export function roundTripTolerance(side: number): { scaleRel: number; rotation: number } {
  const perSide = ROUND_TRIP_SIDE_TOLERANCE / side;
  return {
    scaleRel: Math.max(ROUND_TRIP_SCALE, perSide),
    rotation: Math.max(ROUND_TRIP_ANGLE, (perSide * 180) / Math.PI),
  };
}

// Сошлась ли самопроверка для участка с большей стороной sideMeters на местности.
export function roundTripCloses(check: RoundTrip | null, sideMeters: number): check is RoundTrip {
  if (check === null) return false;
  const tolerance = roundTripTolerance(sideMeters);
  return (
    Math.abs(check.scaleRel) <= tolerance.scaleRel &&
    Math.abs(check.rotation) <= tolerance.rotation &&
    check.rms < ROUND_TRIP_RMS
  );
}

function collect(s: GeoreferenceState, date: Date): ExportData {
  const frame = frameOf(s);
  const size = sizeOnMap(s);

  const catalog = s.source.vertices.map((v, i): CatalogRow => {
    const ll = vertexLatLon(v, s, frame);
    const m = toMercator(ll);
    return {
      номер: i + 1,
      x: roundTo(v.x, M_DIGITS),
      y: roundTo(v.y, M_DIGITS),
      широта: roundTo(ll.lat, LL_DIGITS),
      долгота: roundTo(ll.lon, LL_DIGITS),
      x_3857: roundTo(m.x, M_DIGITS),
      y_3857: roundTo(m.y, M_DIGITS),
      полигон: v.polygon + 1,
      кольцо: v.ring + 1,
      вершина: v.index + 1,
    };
  });

  const gcpStats = stats(s, s.gcp, s.workScale);

  const b = s.source.bbox;
  const corners = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
  const gcp = corners
    .map((c) => {
      const ll = vertexLatLon(c, s, frame);
      return [
        '-gcp',
        roundTo(c.x, M_DIGITS),
        roundTo(c.y, M_DIGITS),
        roundTo(ll.lon, LL_DIGITS),
        roundTo(ll.lat, LL_DIGITS),
      ]
        .map(String)
        .join(' ');
    })
    .join(' ');

  return {
    файл: s.source.name,
    создано: exportStamp(date).iso,
    параметры_трансформирования: {
      модель: 'подобие, 4 параметра',
      опорная_точка_wgs84: {
        широта: roundTo(s.anchor.lat, LL_DIGITS),
        долгота: roundTo(s.anchor.lon, LL_DIGITS),
      },
      опорная_точка_в_координатах_файла: {
        x: roundTo(s.source.center.x, M_DIGITS),
        y: roundTo(s.source.center.y, M_DIGITS),
      },
      поворот_против_часовой_градусы: roundTo(s.rotation, 6),
      азимут_оси_y_градусы: roundTo(azimuthY(s.rotation), 6),
      масштаб_метров_в_единице_файла: s.scale,
      эллипсоид: {
        имя: 'WGS 84',
        большая_полуось_м: WGS84.A,
        обратное_уплощение: WGS84.INV_F,
      },
      как_применять:
        'вычесть из координат вершины опорную точку в координатах файла, умножить на масштаб, ' +
        'повернуть против часовой на угол поворота, отложить полученные метры как восток и север ' +
        'в плоскости ENU от опорной точки WGS 84',
    },
    каталог_координат: catalog,
    опорные_точки: gcpStats.rows.map((r) => ({
      номер: r.pair.n,
      x: roundTo(r.pair.x, M_DIGITS),
      y: roundTo(r.pair.y, M_DIGITS),
      широта: roundTo(r.pair.lat, LL_DIGITS),
      долгота: roundTo(r.pair.lon, LL_DIGITS),
      учитывается: r.used,
      контрольная: r.pair.control,
      dN: roundTo(r.dN, M_DIGITS),
      dE: roundTo(r.dE, M_DIGITS),
      dS: roundTo(r.dS, M_DIGITS),
    })),
    оценка_точности: {
      rms_м: roundTo(gcpStats.rms, M_DIGITS),
      наибольшая_невязка_м: roundTo(gcpStats.max, M_DIGITS),
      rms_по_контрольным_м: roundTo(gcpStats.rmsControl, M_DIGITS),
      масштаб_работ: `1:${String(s.workScale)}`,
      допуск_м: roundTo(gcpStats.tolerance, M_DIGITS),
      вердикт: gcpStats.usedCount >= 2 ? VERDICT_TEXT[gcpStats.verdict] : 'опорные точки не заданы',
      учтённых_точек: gcpStats.usedCount,
      контрольных_точек: gcpStats.controlCount,
      примечание: gcpStats.exact
        ? 'учтённых точек ровно столько, сколько нужно для решения: невязки тождественно ' +
          'нулевые и точность не характеризуют'
        : 'невязки посчитаны по учтённым точкам; контрольные в подгонке не участвовали',
    },
    оценка_модели: {
      радиус_площадки_м: roundTo(size.radius, M_DIGITS),
      ожидаемая_погрешность_касательной_плоскости_м: roundTo(expectedError(size.radius), 9),
      примечание:
        'это только погрешность модели плоскости; ошибка ручного совмещения по подложке ' +
        'на порядки больше',
    },
    gcp_gdal_translate: `-a_srs EPSG:4326 ${gcp}`,
  };
}

// Результат для всех трёх форматов: без пройденной самопроверки выгрузки нет.
export function buildExport(s: GeoreferenceState, date: Date): ExportResult<ExportData> {
  const data = collect(s, date);
  const check = roundTrip(data);
  const size = sizeOnMap(s);
  return roundTripCloses(check, Math.max(size.width, size.height))
    ? { ok: true, value: data }
    : { ok: false, error: { kind: 'RoundTripFailed', roundTrip: check } };
}

export function toJson(s: GeoreferenceState, date: Date): ExportResult<string> {
  const data = buildExport(s, date);
  return data.ok ? { ok: true, value: JSON.stringify(data.value, null, 2) } : data;
}

const CSV_COLUMNS = [
  ['номер', '№', 0],
  ['x', 'X файла', M_DIGITS],
  ['y', 'Y файла', M_DIGITS],
  ['широта', 'Широта', LL_DIGITS],
  ['долгота', 'Долгота', LL_DIGITS],
  ['x_3857', 'X EPSG:3857', M_DIGITS],
  ['y_3857', 'Y EPSG:3857', M_DIGITS],
  ['полигон', 'Полигон', 0],
  ['кольцо', 'Кольцо', 0],
  ['вершина', 'Вершина', 0],
] as const satisfies readonly (readonly [keyof CatalogRow, string, number])[];

export type CsvOptions = { delimiter?: ';' | ','; decimal?: ',' | '.' };

// Разделитель и десятичный знак выбирает пользователь: Excel в русской локали ждёт точку с запятой
// и запятую, в английской — наоборот.
//
// Защита от подстановки формул здесь не нужна: в каталоге нет текстовых ячеек, только числа
// собственных вычислений, а их по security.md не экранируют. Заголовки — константы выше.
export function toCsv(s: GeoreferenceState, options: CsvOptions, date: Date): ExportResult<string> {
  const data = buildExport(s, date);
  if (!data.ok) return data;
  const decimal = options.decimal === '.' ? '.' : ',';
  // Запятая не может быть одновременно разделителем столбцов и десятичным знаком.
  const sep = options.delimiter === ',' && decimal !== ',' ? ',' : ';';

  const cell = (value: number | null, digits: number): string => {
    if (value === null) return '';
    const text = digits ? value.toFixed(digits) : String(value);
    return decimal === ',' ? text.replace('.', ',') : text;
  };

  const lines = [CSV_COLUMNS.map(([, title]) => title).join(sep)];
  for (const row of data.value.каталог_координат) {
    lines.push(CSV_COLUMNS.map(([key, , digits]) => cell(row[key], digits)).join(sep));
  }
  // BOM обязателен: без него Excel показывает кириллицу мусором.
  return { ok: true, value: `\uFEFF${lines.join('\r\n')}\r\n` };
}

// Контур в WGS 84 обычным geojson — открыть в QGIS и посмотреть глазами.
export function toGeoJson(s: GeoreferenceState, date: Date): ExportResult<string> {
  const data = buildExport(s, date);
  if (!data.ok) return data;
  const frame = frameOf(s);

  const coordinates = s.source.polygons.map((rings) =>
    rings.map((ring) => {
      const out = ring.map((p) => {
        const ll = vertexLatLon(p, s, frame);
        return [roundTo(ll.lon, LL_DIGITS), roundTo(ll.lat, LL_DIGITS)];
      });
      const first = out[0];
      // geojson требует замкнутое кольцо; в контуре колец короче трёх вершин нет.
      return first === undefined ? out : [...out, [...first]];
    }),
  );

  return {
    ok: true,
    value: JSON.stringify(
      {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {
              файл: s.source.name,
              создано: exportStamp(date).iso,
              поворот_градусы: roundTo(s.rotation, 6),
              масштаб_метров_в_единице_файла: s.scale,
              опорная_точка: [roundTo(s.anchor.lon, LL_DIGITS), roundTo(s.anchor.lat, LL_DIGITS)],
            },
            geometry: { type: 'MultiPolygon', coordinates },
          },
        ],
      },
      null,
      2,
    ),
  };
}

// Что показать в панели после выгрузки.
export function exportSummary({ source, scale }: Pick<Placement, 'source' | 'scale'>): {
  points: number;
  scale: number;
  width: number;
  height: number;
  unit: Unit | null;
  suspicious: boolean;
} {
  const size = sizeOnMap({ source, scale });
  let known: Unit | null = null;
  for (const u of UNITS) {
    if (u.scale !== null && Math.abs(scale - u.scale) < u.scale * 1e-6) known = u;
  }
  return {
    points: source.counts.vertices,
    scale,
    width: size.width,
    height: size.height,
    unit: known,
    suspicious: Math.abs(Math.log10(scale)) > 0.02,
  };
}

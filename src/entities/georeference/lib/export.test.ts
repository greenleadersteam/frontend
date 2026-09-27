import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Contour } from '@/shared/lib/contour';
import { buildReference } from '@/shared/lib/contour';
import { enuFrame, fitSimilarity } from '@/shared/lib/geodesy';
import { expectedError, sizeOnMap } from '@/shared/lib/georeference';
import {
  contourOf,
  GEOREFERENCE_SAMPLE,
  LARGE_SITE_GEOJSON,
  portedGroup,
  sampleContour,
} from '@/shared/lib/test';

import type { ExportData, ExportResult, GeoreferenceState } from './export';
import {
  buildExport,
  fileName,
  roundTo,
  roundTrip as checkRoundTrip,
  roundTripCloses,
  toCsv,
  toGeoJson,
  toJson,
} from './export';

// Группа «Выгрузка» прототипа (../geojson/tests.html:886-1115): 23 проверки.

const { check } = portedGroup(23);

const DATE = new Date(2026, 8, 23, 14, 5, 0);
// Участок А прототипа: 318 × 241 м, 11 вершин.
const RING_A = [
  [2245600, 476200],
  [2245918, 476200],
  [2245918, 476296],
  [2245842, 476296],
  [2245842, 476358],
  [2245796, 476362],
  [2245796, 476441],
  [2245684, 476441],
  [2245684, 476398],
  [2245637, 476391],
  [2245600, 476348],
  [2245600, 476200],
];
const ANCHOR = { lat: 55.7431, lon: 37.5908 };
const ROT = 33.75;

// Тот же участок, но файл в миллиметрах: координаты в тысячу раз больше, масштаб 0,001,
// на местности те же 900 × 620 м.
function sampleMm(): Contour {
  const { geometry } = GEOREFERENCE_SAMPLE.geojson;
  const coordinates = geometry.coordinates.map((r) =>
    r.map(([x = 0, y = 0]) => [x * 1000, y * 1000]),
  );
  return contourOf({ ...geometry, coordinates }, 'участок-в-миллиметрах.geojson');
}

const state = (scale = 1, source = sampleContour()): GeoreferenceState => ({
  source,
  anchor: ANCHOR,
  rotation: ROT,
  scale,
  gcp: [],
  workScale: 500,
});

function value<T>(result: ExportResult<T>): T {
  if (!result.ok) throw new Error('выгрузка не прошла самопроверку');
  return result.value;
}
const data = (scale?: number, source?: Contour): ExportData =>
  value(buildExport(state(scale, source), DATE));

// Замыкание круга: подобие подгоняется обратно ПО ПАРАМ КООРДИНАТ ИЗ САМОЙ ВЫГРУЗКИ, а не
// по внутреннему состоянию приложения.
function roundTrip(scale?: number, source?: Contour) {
  const d = data(scale, source);
  const p = d.параметры_трансформирования.опорная_точка_wgs84;
  const frame = enuFrame({ lat: p.широта ?? NaN, lon: p.долгота ?? NaN });
  const src = [];
  const dst = [];
  for (const r of d.каталог_координат) {
    src.push({ x: r.x ?? NaN, y: r.y ?? NaN });
    const e = frame.toEnu({ lat: r.широта ?? NaN, lon: r.долгота ?? NaN, h: 0 });
    dst.push({ x: e.e, y: e.n });
  }
  const fit = fitSimilarity(src, dst);
  if (fit === null) throw new Error('подгонка не сошлась');
  return fit;
}

check('Замыкание круга: восстановленный масштаб', () => {
  expect(Math.abs(roundTrip().scale - 1)).toBeLessThanOrEqual(1e-6);
});
check('Замыкание круга: восстановленный угол', () => {
  expect(Math.abs(roundTrip().rotationDeg - ROT)).toBeLessThanOrEqual(1e-4);
});
check('Замыкание круга: невязка RMS', () => {
  expect(roundTrip().rms).toBeLessThanOrEqual(1e-3);
});
check('Замыкание круга для файла в миллиметрах: масштаб 0,001 восстановлен', () => {
  expect(Math.abs(roundTrip(0.001, sampleMm()).scale / 0.001 - 1)).toBeLessThanOrEqual(1e-6);
});
check('Замыкание круга для файла в миллиметрах: угол и невязка', () => {
  const f = roundTrip(0.001, sampleMm());
  expect(Math.max(Math.abs(f.rotationDeg - ROT) / 1e-4, f.rms / 1e-3)).toBeLessThanOrEqual(1);
});

check('Попарные расстояния в выгруженных координатах', () => {
  const d = data();
  const p = d.параметры_трансформирования.опорная_точка_wgs84;
  const frame = enuFrame({ lat: p.широта ?? NaN, lon: p.долгота ?? NaN });
  const rows = d.каталог_координат;
  const enu = rows.map((r) => frame.toEnu({ lat: r.широта ?? NaN, lon: r.долгота ?? NaN, h: 0 }));
  let worst = 0;
  rows.forEach((ri, i) => {
    rows.forEach((rj, j) => {
      const ei = enu[i];
      const ej = enu[j];
      if (j <= i || ei === undefined || ej === undefined) return;
      const src = Math.hypot((ri.x ?? NaN) - (rj.x ?? NaN), (ri.y ?? NaN) - (rj.y ?? NaN));
      const got = Math.hypot(ei.e - ej.e, ei.n - ej.n);
      worst = Math.max(worst, Math.abs(got - src));
    });
  });
  expect(worst).toBeLessThanOrEqual(0.001);
});

function parseCsv(text: string, sep: string, decimal: string) {
  const lines = text
    .replace(/^\uFEFF/, '')
    .trim()
    .split('\r\n');
  const head = (lines.shift() ?? '').split(sep);
  return {
    head,
    rows: lines.map((line) => {
      const cells = line.split(sep);
      return Object.fromEntries(
        head.map((h, i) => {
          const cell = cells[i] ?? '';
          return [h, Number(decimal === ',' ? cell.replace(',', '.') : cell)];
        }),
      );
    }),
  };
}
const csv = (options: Parameters<typeof toCsv>[1]): string => value(toCsv(state(), options, DATE));
const header = (text: string): string => text.replace(/^\uFEFF/, '').split('\r\n')[0] ?? '';

check('CSV: кодировка начинается с BOM, иначе Excel испортит кириллицу', () => {
  expect(csv({}).charCodeAt(0)).toBe(0xfeff);
});
check('CSV: заголовок столбцов на русском', () => {
  expect(parseCsv(csv({ delimiter: ';', decimal: ',' }), ';', ',').head.join('|')).toBe(
    '№|X файла|Y файла|Широта|Долгота|X EPSG:3857|Y EPSG:3857|Полигон|Кольцо|Вершина',
  );
});
check('CSV: строк ровно по числу вершин', () => {
  expect(parseCsv(csv({ delimiter: ';', decimal: ',' }), ';', ',').rows).toHaveLength(10);
});
check('CSV разбирается обратно и даёт те же числа, что JSON', () => {
  const rows = parseCsv(csv({ delimiter: ';', decimal: ',' }), ';', ',').rows;
  let worst = 0;
  data().каталог_координат.forEach((r, i) => {
    const row = rows[i] ?? {};
    const diff = (a: number | undefined, b: number | null) => Math.abs((a ?? NaN) - (b ?? NaN));
    worst = Math.max(
      worst,
      diff(row['X файла'], r.x),
      diff(row['Y файла'], r.y),
      diff(row['Широта'], r.широта),
      diff(row['Долгота'], r.долгота),
      diff(row['X EPSG:3857'], r.x_3857),
      diff(row['Y EPSG:3857'], r.y_3857),
      diff(row['№'], r.номер),
    );
  });
  expect(worst).toBe(0);
});
check('CSV: точка как десятичный знак позволяет запятую в разделителе', () => {
  const head = header(csv({ delimiter: ',', decimal: '.' }));
  expect(head.indexOf(',') > 0 && !head.includes(';')).toBe(true);
});
check('CSV: запятая не может быть сразу разделителем и десятичным знаком', () => {
  // Сочетание, которое тип CsvOptions допускает и которое пользователь может выбрать в панели.
  const head = header(csv({ delimiter: ',', decimal: ',' }));
  expect(head.indexOf(';') > 0 && !head.includes(',')).toBe(true);
});

check('JSON: ни одного числа длиннее 9 знаков после запятой', () => {
  const text = value(toJson(state(), DATE));
  const lengths = (text.match(/\d+\.\d+/g) ?? []).map((n) => n.split('.')[1]?.length ?? 0);
  expect(Math.max(0, ...lengths)).toBeLessThanOrEqual(9);
});
check('JSON: метры в каталоге округлены до 4 знаков', () => {
  let worst = 0;
  for (const r of data().каталог_координат) {
    for (const v of [r.x, r.y, r.x_3857, r.y_3857]) {
      const s = String(v);
      const dot = s.indexOf('.');
      if (dot >= 0) worst = Math.max(worst, s.length - dot - 1);
    }
  }
  expect(worst).toBeLessThanOrEqual(4);
});
check('JSON: параметры совпадают с заданными', () => {
  const p = data().параметры_трансформирования;
  expect(
    [
      p.опорная_точка_wgs84.широта,
      p.опорная_точка_wgs84.долгота,
      p.поворот_против_часовой_градусы,
      p.азимут_оси_y_градусы,
      p.масштаб_метров_в_единице_файла,
      p.опорная_точка_в_координатах_файла.x,
    ].join('|'),
  ).toBe([ANCHOR.lat, ANCHOR.lon, ROT, 360 - ROT, 1, 2180450].join('|'));
});
check('JSON: модель и эллипсоид названы', () => {
  const p = data().параметры_трансформирования;
  expect(
    `${p.модель} / ${p.эллипсоид.имя} / ${String(p.эллипсоид.большая_полуось_м)} / ${String(p.эллипсоид.обратное_уплощение)}`,
  ).toBe('подобие, 4 параметра / WGS 84 / 6378137 / 298.257223563');
});
check('JSON: каталог ссылается на полигон, кольцо и вершину', () => {
  const rows = data().каталог_координат;
  const last = rows.at(-1);
  expect(
    `${String(rows.length)}:${String(last?.полигон)}/${String(last?.кольцо)}/${String(last?.вершина)}`,
  ).toBe('10:1/2/4');
});
check('JSON: оценка модели совпадает с расчётом панели', () => {
  const q = data().оценка_модели;
  const size = sizeOnMap(state());
  expect(
    Math.max(
      Math.abs((q.радиус_площадки_м ?? NaN) - (roundTo(size.radius, 4) ?? NaN)),
      Math.abs(
        (q.ожидаемая_погрешность_касательной_плоскости_м ?? NaN) -
          (roundTo(expectedError(size.radius), 9) ?? NaN),
      ),
    ),
  ).toBe(0);
});
check('JSON: строка GCP для gdal_translate', () => {
  const gcp = data().gcp_gdal_translate;
  expect(
    `${String(gcp.startsWith('-a_srs EPSG:4326'))}/${String((gcp.match(/-gcp /g) ?? []).length)}`,
  ).toBe('true/4');
});

const exportedSchema = z.object({
  type: z.string(),
  features: z.array(
    z.object({
      geometry: z.object({
        type: z.string(),
        coordinates: z.array(z.array(z.array(z.array(z.number())))),
      }),
    }),
  ),
});
const exported = () => exportedSchema.parse(JSON.parse(value(toGeoJson(state(), DATE))));

check('geojson: FeatureCollection с MultiPolygon', () => {
  const g = exported();
  const geometry = g.features[0]?.geometry;
  expect(
    [
      g.type,
      g.features.length,
      geometry?.type,
      geometry?.coordinates.length,
      geometry?.coordinates[0]?.length,
    ].join('/'),
  ).toBe('FeatureCollection/1/MultiPolygon/1/2');
});
check('geojson: все кольца замкнуты', () => {
  const rings = exported().features[0]?.geometry.coordinates.flat() ?? [];
  expect(rings).toHaveLength(2);
  for (const r of rings) expect(r[0]).toEqual(r.at(-1));
});
check('geojson: координаты идут как долгота, широта и совпадают с каталогом', () => {
  const first = exported().features[0]?.geometry.coordinates[0]?.[0]?.[0] ?? [];
  const row = data().каталог_координат[0];
  expect(
    Math.max(
      Math.abs((first[0] ?? NaN) - (row?.долгота ?? NaN)),
      Math.abs((first[1] ?? NaN) - (row?.широта ?? NaN)),
    ),
  ).toBe(0);
});

check('Имя файла: исходное имя, дата и время', () => {
  expect(fileName(sampleContour().name, '_каталог', 'csv', DATE)).toBe(
    'Участок-образец_привязка_2026-09-23_1405_каталог.csv',
  );
});

// В прототипе замыкание круга было только проверкой; здесь без него выгрузки нет.

describe('самопроверка выгрузки', () => {
  // Решение Г2: допуск масштаба и угла — от размера участка, иначе округление до 1e−9° само
  // по себе давало отказы на участках в десятки метров.
  it.each([5, 10, 20])('участок %i м: повороты через 1° — ни одного отказа', (side) => {
    for (const source of [sampleContour(), contourOf({ type: 'Polygon', coordinates: [RING_A] })]) {
      const scale = side / Math.max(source.bbox.width, source.bbox.height);
      for (let rotation = 0; rotation < 360; rotation += 1) {
        const result = buildExport({ ...state(scale, source), rotation }, DATE);
        expect(result.ok, `поворот ${String(rotation)}°`).toBe(true);
      }
    }
  });

  it('каталог, в котором вершина сдвинута на 11 см, самопроверку не проходит', () => {
    const d = data();
    const [first, ...rest] = d.каталог_координат;
    if (first === undefined) throw new Error('пустой каталог');
    const corrupted = {
      ...d,
      каталог_координат: [{ ...first, широта: (first.широта ?? NaN) + 1e-6 }, ...rest],
    };
    expect(roundTripCloses(checkRoundTrip(d), 900)).toBe(true);
    expect(roundTripCloses(checkRoundTrip(corrupted), 900)).toBe(false);
  });

  it('поворот около 180° не даёт ложного отказа: разница углов берётся по кратчайшей дуге', () => {
    for (const rotation of [180, -179.999999, 179.999999]) {
      const s = { ...state(), rotation };
      expect(buildExport(s, DATE).ok).toBe(true);
    }
  });

  it('крупный участок Д (2,7 км, 240 вершин) в Мурманске проходит и читается эталоном', () => {
    const large = contourOf(JSON.parse(LARGE_SITE_GEOJSON), 'участок-Д-крупный.geojson');
    const s: GeoreferenceState = {
      source: large,
      anchor: { lat: 68.9585, lon: 33.0827 },
      rotation: 45,
      scale: 1,
      gcp: [],
      workScale: 500,
    };
    const reference = buildReference(JSON.parse(value(toJson(s, DATE))), 'эталон.json');
    expect(reference.ok && reference.reference.counts.vertices).toBe(240);
  });
});

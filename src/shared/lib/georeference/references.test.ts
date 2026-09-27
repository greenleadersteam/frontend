import { afterAll, expect, vi } from 'vitest';
import { z } from 'zod';

import type { Reference } from '@/shared/lib/contour';
import { buildReference, detectResult, diagnose, readGeoJson } from '@/shared/lib/contour';
import { enuToGeodetic, vincentyDirect } from '@/shared/lib/geodesy';
import { contourOf, GEOREFERENCE_SAMPLE, portedGroup, sampleContour } from '@/shared/lib/test';

import type { ExportResult, GeoreferenceState } from './export';
import { toGeoJson, toJson } from './export';
import { formatDecimal, formatDegrees } from './format';
import { compare, spread } from './placement';

// Группа «Эталонные слои и сравнение» прототипа (../geojson/tests.html:1120-1362): 31 проверка.
// Эталоны собираются из настоящей выгрузки, а не из объекта в памяти. Пояс закреплён: штамп
// времени выгрузки — местное время со сдвигом.
vi.stubEnv('TZ', 'Europe/Moscow');
afterAll(() => {
  vi.unstubAllEnvs();
});

const { check } = portedGroup(31);

const DATE = new Date(2026, 8, 23, 14, 5, 0);
const ANCHOR = { lat: 55.7431, lon: 37.5908 };
const ROT = 33.75;

const state = (): GeoreferenceState => ({
  source: sampleContour(),
  anchor: ANCHOR,
  rotation: ROT,
  scale: 1,
  gcp: [],
  workScale: 500,
});

function text(result: ExportResult<string>): string {
  if (!result.ok) throw new Error('выгрузка не прошла самопроверку');
  return result.value;
}
const exportedGeoJson = (): unknown => JSON.parse(text(toGeoJson(state(), DATE)));
const exportedJson = (): unknown => JSON.parse(text(toJson(state(), DATE)));

function reference(value: unknown, fileName: string): Reference {
  const built = buildReference(value, fileName);
  if (!built.ok) throw new Error(`эталон не собран: ${built.error.kind}`);
  return built.reference;
}

check('Распознавание: выгруженный geojson', () => {
  const found = detectResult(exportedGeoJson());
  expect(`${String(found?.kind)} / ${String(found?.created)}`).toBe(
    'geojson / 2026-09-23T14:05:00 UTC+03:00',
  );
});
check('Распознавание: выгруженный JSON', () => {
  expect(detectResult(exportedJson())?.kind).toBe('json');
});
check('Распознавание: обычный полигон — не результат', () => {
  expect(detectResult(GEOREFERENCE_SAMPLE.geojson)).toBeNull();
});
check('Распознавание: geojson без наших свойств — не результат', () => {
  const g = z
    .looseObject({
      features: z.tuple([z.looseObject({ properties: z.record(z.string(), z.unknown()) })]),
    })
    .parse(exportedGeoJson());
  const [feature] = g.features;
  const properties = { ...feature.properties };
  delete properties.опорная_точка;
  const stripped = { ...g, features: [{ ...feature, properties }] };
  expect(detectResult(stripped)).toBeNull();
});
check('Распознавание: чтение файла сообщает о результате', () => {
  const read = readGeoJson(text(toGeoJson(state(), DATE)));
  expect(read.ok && read.result?.kind).toBe('geojson');
});

const summaryOf = (r: Reference): string =>
  [
    r.counts.polygons,
    r.counts.rings,
    r.counts.vertices,
    r.rotation,
    r.scale,
    r.anchor.lat,
    r.anchor.lon,
  ].join('|');

check('Эталон из geojson: кольца, вершины, параметры', () => {
  expect(summaryOf(reference(exportedGeoJson(), 'эталон.geojson'))).toBe(
    ['1', '2', '10', ROT, 1, ANCHOR.lat, ANCHOR.lon].join('|'),
  );
});
check('Эталон из JSON: те же кольца и параметры', () => {
  expect(summaryOf(reference(exportedJson(), 'эталон.json'))).toBe(
    ['1', '2', '10', ROT, 1, ANCHOR.lat, ANCHOR.lon].join('|'),
  );
});
check('Эталон: геометрия из geojson и из JSON совпадает', () => {
  const a = reference(exportedGeoJson(), 'a');
  const c = reference(exportedJson(), 'b');
  let worst = 0;
  a.polygons.forEach((polygon, pi) => {
    polygon.forEach((ring, ri) => {
      ring.forEach((p, vi) => {
        const q = c.polygons[pi]?.[ri]?.[vi];
        worst = Math.max(
          worst,
          Math.abs(p.lat - (q?.lat ?? NaN)),
          Math.abs(p.lon - (q?.lon ?? NaN)),
        );
      });
    });
  });
  expect(worst).toBe(0);
});
check('Эталон: замыкающая вершина не задваивается', () => {
  const ring = reference(exportedGeoJson(), 'a').polygons[0]?.[0] ?? [];
  const first = ring[0];
  const last = ring.at(-1);
  const closed = first?.lat === last?.lat && first?.lon === last?.lon;
  expect(`${String(ring.length)}/${String(closed)}`).toBe('6/false');
});
check('Эталон: чужой файл отвергается с понятным кодом', () => {
  const built = buildReference(GEOREFERENCE_SAMPLE.geojson, 'чужой');
  expect(built.ok ? 'без ошибки' : built.error.kind).toBe('NotResult');
});

function movedState(north: number, rotationDelta = 0, scaleFactor = 1) {
  const g = enuToGeodetic({ e: 0, n: north, u: 0 }, ANCHOR);
  return {
    anchor: { lat: g.lat, lon: g.lon },
    rotation: ROT + rotationDelta,
    scale: 1 * scaleFactor,
  };
}

check('Сравнение: сдвиг на 100 м измеряется как 100 м', () => {
  const ref = reference(exportedGeoJson(), 'эталон');
  expect(Math.abs(compare(movedState(100), ref).shift - 100)).toBeLessThanOrEqual(1e-3);
});
check('Сравнение: сдвиг на 12 345 м по геодезической линии', () => {
  const ref = reference(exportedGeoJson(), 'эталон');
  const far = vincentyDirect(ANCHOR, 57, 12345);
  const c = compare({ anchor: far, rotation: ROT, scale: 1 }, ref);
  expect(Math.max(Math.abs(c.shift - 12345), Math.abs(c.azimuth - 57) * 100)).toBeLessThanOrEqual(
    1e-4,
  );
});
// Единое направление: все величины — текущая привязка относительно эталонной. Поворот со знаком
// по кратчайшей дуге, масштаб относительной разницей, сдвиг без знака.
check('Сравнение: разница поворота и масштаба', () => {
  const ref = reference(exportedGeoJson(), 'эталон');
  const c = compare(movedState(0, 0.5, 1.0002), ref);
  expect(`${formatDegrees(c.rotation, 3)} / ${String(Math.round(c.scaleRel * 1e6))} млн⁻¹`).toBe(
    '0,500° / 200 млн⁻¹',
  );
});
check('Сравнение: поворот считается по короткой дуге', () => {
  const c = compare(
    { anchor: ANCHOR, rotation: -179, scale: 1 },
    { anchor: ANCHOR, rotation: 179, scale: 1 },
  );
  expect(formatDegrees(c.rotation, 0)).toBe('2°');
});

// Тот самый круг, в котором в прототипе нашлась дыра: раньше сквозь выгрузку проверялся только
// сдвиг.

function place(rotation: number, scale = 1, north = 0): GeoreferenceState {
  let anchor = ANCHOR;
  if (north) {
    const g = enuToGeodetic({ e: 0, n: north, u: 0 }, ANCHOR);
    anchor = { lat: g.lat, lon: g.lon };
  }
  return { source: sampleContour(), anchor, rotation, scale, gcp: [], workScale: 500 };
}

function referenceOf(s: GeoreferenceState, kind: 'json' | 'geojson' = 'geojson'): Reference {
  const exported = kind === 'json' ? toJson(s, DATE) : toGeoJson(s, DATE);
  return reference(JSON.parse(text(exported)), `эталон.${kind}`);
}

check('Сквозная: эталон 30°, текущая 0° — текущая отстаёт на 30°', () => {
  expect(formatDegrees(compare(place(0), referenceOf(place(30))).rotation, 3)).toBe('−30,000°');
});
check('Сквозная: то же через каталог координат JSON', () => {
  expect(formatDegrees(compare(place(0), referenceOf(place(30), 'json')).rotation, 3)).toBe(
    '−30,000°',
  );
});
check('Сквозная: эталон 0°, текущая 30° — знак меняется на плюс', () => {
  expect(formatDegrees(compare(place(30), referenceOf(place(0))).rotation, 3)).toBe('30,000°');
});
check('Сквозная: поворот через ноль — 20° по кратчайшей дуге, а не 340°', () => {
  expect(formatDegrees(compare(place(10), referenceOf(place(350))).rotation, 3)).toBe('20,000°');
});
check('Сквозная: отрицательный поворот эталона', () => {
  expect(formatDegrees(compare(place(0), referenceOf(place(-45))).rotation, 3)).toBe('45,000°');
});
check('Сквозная: сотые доли градуса видны, а не прячутся в ноль', () => {
  expect(formatDegrees(compare(place(0.03), referenceOf(place(0))).rotation, 3)).toBe('0,030°');
});
check('Сквозная: масштаб эталона 1 против текущего 2 даёт ровно 1,0', () => {
  const c = compare(place(0, 2), referenceOf(place(0, 1)));
  expect(Math.abs(c.scaleRel - 1)).toBeLessThanOrEqual(1e-12);
});
check('Сквозная: мелкая разница масштаба — плюс два миллионных', () => {
  const c = compare(place(0, 1.000002), referenceOf(place(0, 1)));
  expect(`${c.scaleRel > 0 ? '+' : ''}${String(Math.round(c.scaleRel * 1e6))} млн⁻¹`).toBe(
    '+2 млн⁻¹',
  );
});

// Все три величины сразу: текущая привязка сдвинута на 100 м, повёрнута на 30° и растянута
// в полтора раза.
const triple = () => compare(place(30, 1.5, 100), referenceOf(place(0, 1, 0)));

check('Три величины сразу: сдвиг ровно 100 м', () => {
  expect(Math.abs(triple().shift - 100)).toBeLessThanOrEqual(1e-3);
});
check('Три величины сразу: поворот +30° (текущая относительно эталона)', () => {
  expect(formatDegrees(triple().rotation, 3)).toBe('30,000°');
});
check('Три величины сразу: масштаб +0,5 относительно эталона', () => {
  expect(Math.abs(triple().scaleRel - 0.5)).toBeLessThanOrEqual(1e-12);
});
check('Три величины сразу: ничего не перепуталось местами', () => {
  const c = triple();
  expect([Math.round(c.shift), Math.round(c.rotation), c.scaleRel.toFixed(1)].join('|')).toBe(
    '100|30|0.5',
  );
});

check('Разброс по повороту при 0°, 12° и 350° равен 22°', () => {
  const sp = spread([
    { anchor: ANCHOR, rotation: 0 },
    { anchor: ANCHOR, rotation: 12 },
    { anchor: ANCHOR, rotation: 350 },
  ]);
  expect(formatDegrees(sp.rotation, 2)).toBe('22,00°');
});
check('Разброс по повороту идёт по той же кратчайшей дуге', () => {
  const sp = spread([
    { anchor: ANCHOR, rotation: 350 },
    { anchor: ANCHOR, rotation: 10 },
  ]);
  const pairwise = compare(
    { anchor: ANCHOR, rotation: 10, scale: 1 },
    { anchor: ANCHOR, rotation: 350, scale: 1 },
  );
  expect(
    `${formatDegrees(sp.rotation, 3)} / ${formatDecimal(Math.abs(pairwise.rotation), 3)}`,
  ).toBe('20,000° / 20,000');
});
check('Разброс: максимум по трём привязкам', () => {
  const north = enuToGeodetic({ e: 0, n: 100, u: 0 }, ANCHOR);
  const south = enuToGeodetic({ e: 0, n: -150, u: 0 }, ANCHOR);
  const sp = spread([
    { anchor: ANCHOR, rotation: 0 },
    { anchor: { lat: north.lat, lon: north.lon }, rotation: 1 },
    { anchor: { lat: south.lat, lon: south.lon }, rotation: -0.5 },
  ]);
  expect(
    Math.max(Math.abs(sp.shift - 250), Math.abs(sp.rotation - 1.5) * 1000),
  ).toBeLessThanOrEqual(1e-3);
});
check('Разброс: одна привязка — нечего сравнивать', () => {
  const sp = spread([{ anchor: ANCHOR, rotation: 10 }]);
  expect([sp.shift, sp.rotation, sp.count].join('/')).toBe('0/0/1');
});

check('Предупреждение про градусы подсказывает эталонный слой', () => {
  const degrees = contourOf(
    {
      type: 'Polygon',
      coordinates: [
        [
          [37.6, 55.75],
          [37.6005, 55.75],
          [37.6005, 55.7504],
          [37.6, 55.7504],
        ],
      ],
    },
    'g',
  );
  expect(diagnose(degrees)[0]?.text.indexOf('эталонный слой')).toBeGreaterThan(0);
});

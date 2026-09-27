import { z } from 'zod';

import type { LatLon, LocalPoint } from '../geodesy';

// Разбор контура границы проектирования из GeoJSON. Перенесено из прототипа
// ../geojson/js/store.js:39-145 и 148-251 без изменений правил разбора.

export type ContourVertex = LocalPoint & { polygon: number; ring: number; index: number };

export type Contour = {
  name: string;
  // Полигоны → кольца → вершины; замыкающая вершина кольца отброшена.
  polygons: LocalPoint[][][];
  // Плоский список вершин со ссылкой на полигон, кольцо и номер в кольце.
  vertices: ContourVertex[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
  // Центр габарита, а не центроид: это опорная точка контура.
  center: LocalPoint;
  // Наибольшее расстояние от центра габарита до вершины.
  radius: number;
  counts: { polygons: number; rings: number; vertices: number };
};

export type ParseError =
  | { kind: 'NotJson' }
  | { kind: 'NoPolygons' }
  | { kind: 'AllVerticesInvalid' }
  | { kind: 'NoRings' };

export type ParseResult = { ok: true; contour: Contour } | { ok: false; error: ParseError };

// Тексты прототипа: что случилось и что с этим сделать.
export const PARSE_ERROR_TEXT: Record<ParseError['kind'], string> = {
  NotJson:
    'Файл не разбирается как JSON. Проверьте, что это geojson, а не архив, таблица или shapefile.',
  NoPolygons:
    'В файле нет полигонов. Нужны Polygon или MultiPolygon — точки и линии для границы проектирования не подойдут.',
  AllVerticesInvalid:
    'Координаты вершин не числовые. Ожидаются пары чисел, например [2180000, 476000].',
  NoRings:
    'В файле нет замкнутых колец: в кольце должно быть не меньше трёх вершин с числовыми координатами.',
};

// Обёртки проверяются по форме, а содержимое колец — поштучно: нечисловая вершина пропускается
// и не роняет разбор, как и в прототипе.
const node = z.discriminatedUnion('type', [
  z.object({ type: z.literal('FeatureCollection'), features: z.array(z.unknown()) }),
  z.object({ type: z.literal('Feature'), geometry: z.unknown() }),
  z.object({ type: z.literal('GeometryCollection'), geometries: z.array(z.unknown()) }),
  z.object({ type: z.literal('Polygon'), coordinates: z.array(z.unknown()) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.unknown()) }),
]);
const rings = z.array(z.unknown());
// Координаты бывают [x, y] и [x, y, z] — берутся первые две.
const position = z.tuple([z.number(), z.number()]).rest(z.unknown());

const MAX_DEPTH = 12;

// Собираем кольца из любой обёртки: FeatureCollection, Feature, GeometryCollection или голая
// геометрия.
function collect(value: unknown, out: unknown[][], depth: number): void {
  if (depth > MAX_DEPTH) return;
  const parsed = node.safeParse(value);
  if (!parsed.success) return;
  const item = parsed.data;
  switch (item.type) {
    case 'FeatureCollection':
      for (const feature of item.features) collect(feature, out, depth + 1);
      return;
    case 'Feature':
      collect(item.geometry, out, depth + 1);
      return;
    case 'GeometryCollection':
      for (const geometry of item.geometries) collect(geometry, out, depth + 1);
      return;
    case 'Polygon':
      out.push(item.coordinates);
      return;
    case 'MultiPolygon':
      for (const polygon of item.coordinates) {
        const parsedRings = rings.safeParse(polygon);
        if (parsedRings.success) out.push(parsedRings.data);
      }
      return;
    default: {
      const unexpected: never = item;
      return unexpected;
    }
  }
}

export function buildContour(value: unknown, name?: string): ParseResult {
  const raw: unknown[][] = [];
  collect(value, raw, 0);
  if (raw.length === 0) return { ok: false, error: { kind: 'NoPolygons' } };

  let numeric = 0;
  const polygons: LocalPoint[][][] = [];
  for (const rawRings of raw) {
    const out: LocalPoint[][] = [];
    for (const rawRing of rawRings) {
      const parsedRing = rings.safeParse(rawRing);
      if (!parsedRing.success) continue;
      const ring: LocalPoint[] = [];
      for (const coordinate of parsedRing.data) {
        const parsed = position.safeParse(coordinate);
        if (!parsed.success) continue;
        numeric += 1;
        ring.push({ x: parsed.data[0], y: parsed.data[1] });
      }
      // Замыкающая вершина совпадает с первой — держать её незачем.
      const first = ring[0];
      const last = ring.at(-1);
      if (ring.length > 1 && first !== undefined && last !== undefined) {
        if (first.x === last.x && first.y === last.y) ring.pop();
      }
      if (ring.length >= 3) out.push(ring);
    }
    if (out.length > 0) polygons.push(out);
  }

  if (numeric === 0) return { ok: false, error: { kind: 'AllVerticesInvalid' } };
  if (polygons.length === 0) return { ok: false, error: { kind: 'NoRings' } };

  const vertices: ContourVertex[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let ringCount = 0;
  polygons.forEach((polygon, polygonIndex) => {
    polygon.forEach((ring, ringIndex) => {
      ringCount += 1;
      ring.forEach((point, index) => {
        vertices.push({ x: point.x, y: point.y, polygon: polygonIndex, ring: ringIndex, index });
        if (point.x < minX) minX = point.x;
        if (point.x > maxX) maxX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.y > maxY) maxY = point.y;
      });
    });
  });

  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  let radius = 0;
  for (const vertex of vertices) {
    const d = Math.sqrt((vertex.x - center.x) ** 2 + (vertex.y - center.y) ** 2);
    if (d > radius) radius = d;
  }

  return {
    ok: true,
    contour: {
      // Пустое имя, как и отсутствующее, — «Контур».
      name: name === undefined || name === '' ? 'Контур' : name,
      polygons,
      vertices,
      bbox: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY },
      center,
      radius,
      counts: { polygons: polygons.length, rings: ringCount, vertices: vertices.length },
    },
  };
}

// Выгрузка модуля — географические координаты в градусах. Если читать её как исходный контур,
// получится участок в полсантиметра, поэтому такие файлы распознаются до разбора.

export type DetectedResult = {
  kind: 'json' | 'geojson';
  created: string | null;
  name: string | null;
};

const record = z.record(z.string(), z.unknown());
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);

// Свойства результата в geojson — по ним выгрузка узнаётся и собирается эталоном.
const resultProperties = z.looseObject({
  поворот_градусы: z.number(),
  масштаб_метров_в_единице_файла: z.number(),
  опорная_точка: z.tuple([z.number(), z.number()]),
});

function resultFeature(value: unknown): Record<string, unknown> | null {
  const parsed = record.safeParse(value);
  if (!parsed.success) return null;
  const object = parsed.data;
  if (object.type === 'FeatureCollection' && Array.isArray(object.features)) {
    const first: unknown = object.features[0];
    const feature = record.safeParse(first);
    return feature.success ? feature.data : null;
  }
  return object.type === 'Feature' ? object : null;
}

export function detectResult(value: unknown): DetectedResult | null {
  const parsed = record.safeParse(value);
  if (!parsed.success) return null;
  const object = parsed.data;

  // Проверка на истинность, как в прототипе: пустая строка или ноль — не выгрузка.
  if (Boolean(object.параметры_трансформирования) && Boolean(object.каталог_координат)) {
    return { kind: 'json', created: text(object.создано), name: text(object.файл) };
  }

  const properties = record.safeParse(resultFeature(value)?.properties);
  if (!properties.success) return null;
  const p = properties.data;
  if (
    p.поворот_градусы !== undefined &&
    p.масштаб_метров_в_единице_файла !== undefined &&
    p.опорная_точка !== undefined
  ) {
    return { kind: 'geojson', created: text(p.создано), name: text(p.файл) };
  }
  return null;
}

export type ReadResult =
  | { ok: true; value: unknown; result: DetectedResult | null }
  | { ok: false; error: { kind: 'NotJson' } };

// Прочитать файл и сказать, что это: исходный контур или собственная выгрузка. Разбор в контур
// делает уже вызывающая сторона.
export function readGeoJson(source: string): ReadResult {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return { ok: false, error: { kind: 'NotJson' } };
  }
  return { ok: true, value, result: detectResult(value) };
}

export function parseContour(source: string, name?: string): ParseResult {
  const read = readGeoJson(source);
  return read.ok ? buildContour(read.value, name) : read;
}

export type Reference = {
  name: string;
  origin: string | null;
  created: string | null;
  kind: DetectedResult['kind'];
  anchor: LatLon;
  rotation: number;
  scale: number;
  // Полигоны → кольца → вершины в географическом положении.
  polygons: LatLon[][][];
  counts: { polygons: number; rings: number; vertices: number };
};

export type ReferenceResult =
  | { ok: true; reference: Reference }
  | { ok: false; error: { kind: 'NotResult' } | { kind: 'NoRings' } };

export const REFERENCE_ERROR_TEXT = {
  NotResult:
    'Это не результат привязки из этого приложения. Эталоном загружается JSON или geojson, ' +
    'выгруженный из панели привязки.',
  NoRings:
    'В результате привязки нет колец с координатами. Выгрузите привязку заново и загрузите ' +
    'новый файл.',
} as const;

const lonLat = z.tuple([z.number(), z.number()]).rest(z.unknown());
const geometryOfResult = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(lonLat)) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(z.array(lonLat))) }),
]);
const jsonParams = z.looseObject({
  опорная_точка_wgs84: z.looseObject({ широта: z.number(), долгота: z.number() }),
  поворот_против_часовой_градусы: z.number(),
  масштаб_метров_в_единице_файла: z.number(),
});
const catalogRow = z.looseObject({
  полигон: z.number(),
  кольцо: z.number(),
  вершина: z.number(),
  широта: z.number(),
  долгота: z.number(),
});

// Кольцо эталона: замыкающая вершина не задваивается, меньше трёх вершин — не кольцо.
function openRing(ring: LatLon[]): LatLon[] | null {
  const first = ring[0];
  const last = ring.at(-1);
  if (ring.length > 1 && first !== undefined && last !== undefined) {
    if (first.lat === last.lat && first.lon === last.lon) ring.pop();
  }
  return ring.length >= 3 ? ring : null;
}

// Эталонный слой: контур в его настоящем географическом положении. Собирается и из geojson,
// и из каталога координат в JSON.
export function buildReference(value: unknown, fileName?: string): ReferenceResult {
  const found = detectResult(value);
  if (found === null) return { ok: false, error: { kind: 'NotResult' } };

  let polygons: LatLon[][][] = [];
  let anchor: LatLon;
  let rotation: number;
  let scale: number;

  if (found.kind === 'geojson') {
    const feature = resultFeature(value);
    const properties = resultProperties.safeParse(feature?.properties);
    if (!properties.success) return { ok: false, error: { kind: 'NotResult' } };
    const p = properties.data;
    anchor = { lat: p.опорная_точка[1], lon: p.опорная_точка[0] };
    rotation = p.поворот_градусы;
    scale = p.масштаб_метров_в_единице_файла;
    const geometry = geometryOfResult.safeParse(feature?.geometry);
    const raw = !geometry.success
      ? []
      : geometry.data.type === 'Polygon'
        ? [geometry.data.coordinates]
        : geometry.data.coordinates;
    for (const polygon of raw) {
      const out = polygon.flatMap((ring) => {
        // [lon, lat] → {lat, lon}
        const open = openRing(ring.map(([lon, lat]) => ({ lat, lon })));
        return open === null ? [] : [open];
      });
      if (out.length > 0) polygons.push(out);
    }
  } else {
    const object = record.parse(value);
    const params = jsonParams.safeParse(object.параметры_трансформирования);
    const catalog = z.array(catalogRow).safeParse(object.каталог_координат);
    if (!params.success || !catalog.success) return { ok: false, error: { kind: 'NotResult' } };
    anchor = {
      lat: params.data.опорная_точка_wgs84.широта,
      lon: params.data.опорная_точка_wgs84.долгота,
    };
    rotation = params.data.поворот_против_часовой_градусы;
    scale = params.data.масштаб_метров_в_единице_файла;

    const buckets = new Map<string, z.infer<typeof catalogRow>[]>();
    for (const row of catalog.data) {
      const key = `${String(row.полигон)}/${String(row.кольцо)}`;
      const bucket = buckets.get(key);
      if (bucket === undefined) buckets.set(key, [row]);
      else bucket.push(row);
    }
    const byPolygon: LatLon[][][] = [];
    // Порядок ключей — строковый, как у sort() в прототипе.
    const ordered = [...buckets.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [key, bucket] of ordered) {
      const rows = bucket.sort((a, b) => a.вершина - b.вершина);
      const line = rows.map((row) => ({ lat: row.широта, lon: row.долгота }));
      if (line.length < 3) continue;
      const polygonIndex = Number(key.split('/')[0]) - 1;
      (byPolygon[polygonIndex] ??= []).push(line);
    }
    polygons = byPolygon.filter((polygon) => polygon.length > 0);
  }

  if (polygons.length === 0) return { ok: false, error: { kind: 'NoRings' } };

  let ringCount = 0;
  let vertexCount = 0;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      ringCount += 1;
      vertexCount += ring.length;
    }
  }

  return {
    ok: true,
    reference: {
      name: fileName === undefined || fileName === '' ? (found.name ?? 'Эталон') : fileName,
      origin: found.name,
      created: found.created,
      kind: found.kind,
      anchor,
      rotation,
      scale,
      polygons,
      counts: { polygons: polygons.length, rings: ringCount, vertices: vertexCount },
    },
  };
}

import { expect } from 'vitest';

import type { Contour } from '@/shared/lib/contour';
import { diagnose, millimetreHint, parseContour } from '@/shared/lib/contour';
import { contourOf, portedGroup, sampleContour } from '@/shared/lib/test';

import { formatDecimal, formatDegrees, formatLength } from './format';
import type { Placement } from './placement';
import {
  azimuthY,
  enuToLocal,
  frameOf,
  handleDistance,
  localToEnu,
  rotationFromEnu,
  sizeOnMap,
  vertexLatLon,
} from './placement';
import type { Session } from './session';
import {
  createSession,
  loadContour,
  moveBy,
  redo,
  rotateBy,
  setScale,
  snapshot,
  undo,
  updateSession,
} from './session';

// Группа «Разбор файла и преобразование» прототипа (../geojson/tests.html:665-881): 43 проверки.
// Проверки истории в прототипе идут цепочкой по общему GP.store; здесь каждая начинает с чистой
// сессии и повторяет нужные ей шаги.
const { check } = portedGroup(43);

type Ring = number[][];
const ring = (x: number, y: number, s: number): Ring => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
  [x, y],
];
const poly = (coordinates: Ring[]) => ({ type: 'Polygon', coordinates });

check('Разбор: голая геометрия Polygon', () => {
  expect(contourOf(poly([ring(0, 0, 100)]), 'a').counts).toEqual({
    polygons: 1,
    rings: 1,
    vertices: 4,
  });
});
check('Разбор: замыкающая вершина отброшена', () => {
  expect(contourOf(poly([ring(0, 0, 100)]), 'a').counts.vertices).toBe(4);
});
check('Разбор: внутреннее кольцо', () => {
  const feature = { type: 'Feature', geometry: poly([ring(0, 0, 100), ring(20, 20, 30)]) };
  expect(contourOf(feature, 'b').counts.rings).toBe(2);
});
check('Разбор: MultiPolygon с дыркой', () => {
  const multi = {
    type: 'MultiPolygon',
    coordinates: [[ring(0, 0, 100)], [ring(300, 0, 50), ring(310, 10, 20)]],
  };
  expect(contourOf(multi, 'c').counts).toEqual({ polygons: 2, rings: 3, vertices: 12 });
});
check('Разбор: FeatureCollection, точка пропущена', () => {
  const collection = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: poly([ring(0, 0, 100)]) },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [5, 5] } },
      { type: 'Feature', geometry: poly([ring(500, 500, 80)]) },
    ],
  };
  expect(contourOf(collection, 'd').counts.polygons).toBe(2);
});
check('Разбор: из [x, y, z] берутся первые две', () => {
  const contour = contourOf(
    poly([
      [
        [1, 2, 12],
        [11, 2, 13],
        [11, 12, 9],
        [1, 12, 7],
      ],
    ]),
    'e',
  );
  expect(contour.polygons[0]?.[0]?.[0]).toEqual({ x: 1, y: 2 });
});

check('Образец: габарит 900 × 620 м', () => {
  const { bbox } = sampleContour();
  expect(`${formatDecimal(bbox.width, 1)} × ${formatDecimal(bbox.height, 1)}`).toBe(
    '900,0 × 620,0',
  );
});
check('Образец: центр габарита', () => {
  const { center } = sampleContour();
  expect(`${String(center.x)}; ${String(center.y)}`).toBe('2180450; 476310');
});
check('Образец: вершин и колец', () => {
  const { counts } = sampleContour();
  expect(`${String(counts.vertices)}/${String(counts.rings)}`).toBe('10/2');
});

function errorOf(text: string): string {
  const parsed = parseContour(text, 'x');
  return parsed.ok ? 'без ошибки' : parsed.error.kind;
}
check('Ошибка: не JSON', () => {
  expect(errorOf('это не json')).toBe('NotJson');
});
check('Ошибка: нет полигонов', () => {
  expect(errorOf('{"type":"Feature","geometry":{"type":"Point","coordinates":[1,2]}}')).toBe(
    'NoPolygons',
  );
});
check('Ошибка: все вершины нечисловые', () => {
  expect(errorOf('{"type":"Polygon","coordinates":[[["a","b"],["c","d"],["e","f"]]]}')).toBe(
    'AllVerticesInvalid',
  );
});

const levels = (contour: Contour): string =>
  diagnose(contour)
    .map((w) => w.level)
    .join(',');
check('Диагностика: координаты похожи на градусы', () => {
  const degrees = poly([
    [
      [37.6, 55.75],
      [37.6005, 55.75],
      [37.6005, 55.7504],
      [37.6, 55.7504],
    ],
  ]);
  expect(levels(contourOf(degrees, 'g'))).toBe('danger');
});
check('Диагностика: габарит больше 500 км', () => {
  expect(levels(contourOf(poly([ring(0, 0, 600000)]), 'h'))).toBe('warning');
});
check('Диагностика: габарит вырожден по оси', () => {
  const line = poly([
    [
      [0, 0],
      [100, 0],
      [50, 0],
      [25, 0],
    ],
  ]);
  expect(levels(contourOf(line, 'i'))).toBe('warning');
});
check('Диагностика: обычный участок в метрах без предупреждений', () => {
  expect(levels(sampleContour())).toBe('');
});

// Прямоугольники с габаритами файлов из examples/, как в прототипе; сами файлы проверяются
// в contour.test.ts.

const boxOf = (w: number, h: number): Contour =>
  contourOf(
    poly([
      [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
        [0, 0],
      ],
    ]),
    'габарит',
  );
function hintText(contour: Contour): string {
  const hint = millimetreHint(contour);
  return hint === null
    ? 'нет'
    : `${formatDecimal(hint.mmWidth, 1)} × ${formatDecimal(hint.mmHeight, 1)}`;
}

check('Миллиметры: габарит как у участка Г даёт подсказку 318 × 241 м', () => {
  expect(hintText(boxOf(318000, 241000))).toBe('318,0 × 241,0');
});
check('Миллиметры: участок Д в метрах (2,7 км) подсказки не даёт', () => {
  expect(hintText(boxOf(2660.9, 2576))).toBe('нет');
});
check('Миллиметры: участок А в метрах (318 м) подсказки не даёт', () => {
  expect(hintText(boxOf(318, 241))).toBe('нет');
});
check('Миллиметры: 50 000 единиц — подсказка про участок 50 м', () => {
  expect(hintText(boxOf(50000, 20000))).toBe('50,0 × 20,0');
});
check('Миллиметры: меньше 10 000 единиц — молчит', () => {
  expect(hintText(boxOf(9000, 4000))).toBe('нет');
});
check('Миллиметры: 2 000 000 единиц — подсказка про участок 2 км', () => {
  expect(hintText(boxOf(2000000, 1500000))).toBe('2\u00A0000,0 × 1\u00A0500,0');
});
check('Миллиметры: рядом с подсказкой остаётся предупреждение про 500 км', () => {
  expect(levels(boxOf(2000000, 1500000))).toBe('warning');
});
check('Миллиметры: больше 5 000 000 единиц — молчит', () => {
  expect(hintText(boxOf(6000000, 100000))).toBe('нет');
});

check('Выбор единиц сбрасывается новым файлом и откатывается отменой', () => {
  // Предыдущий файл единицы уже подтвердил: новый файл должен сбросить выбор.
  const confirmed = updateSession(createSession(), { unitsConfirmed: true });
  const loaded = loadContour(confirmed, boxOf(318000, 241000), { lat: 55.75, lon: 37.62 });
  const chosen = updateSession(setScale(snapshot(loaded), 0.001), { unitsConfirmed: true });
  const undone = undo(chosen);
  expect(
    [loaded.unitsConfirmed, chosen.unitsConfirmed, undone.unitsConfirmed, undone.scale].join('/'),
  ).toBe('false/true/false/1');
});

const ANCHOR = { lat: 55.7558, lon: 37.6173 };

function pairwiseError(placement: Placement): number {
  const frame = frameOf(placement);
  const vs = placement.source.vertices;
  const pts = vs.map((v) => frame.toEnu({ ...vertexLatLon(v, placement, frame), h: 0 }));
  let worst = 0;
  vs.forEach((vi, i) => {
    vs.forEach((vj, j) => {
      const pi = pts[i];
      const pj = pts[j];
      if (j <= i || pi === undefined || pj === undefined) return;
      const src = Math.hypot(vi.x - vj.x, vi.y - vj.y) * placement.scale;
      const got = Math.hypot(pi.e - pj.e, pi.n - pj.n);
      worst = Math.max(worst, Math.abs(got - src));
    });
  });
  return worst;
}

for (const rot of [0, 37, -15.5]) {
  check(`Преобразование: поворот ${String(rot)}° сохраняет все попарные расстояния`, () => {
    expect(
      pairwiseError({ source: sampleContour(), anchor: ANCHOR, rotation: rot, scale: 1 }),
    ).toBeLessThanOrEqual(0.005);
  });
}
check('Преобразование: масштаб 0,001 сохраняет расстояния', () => {
  expect(
    pairwiseError({ source: sampleContour(), anchor: ANCHOR, rotation: 20, scale: 0.001 }),
  ).toBeLessThanOrEqual(0.005);
});

function backAndForth(rotation: number): number {
  const placement = { source: sampleContour(), anchor: ANCHOR, rotation, scale: 1 };
  const back = enuToLocal(localToEnu({ x: 2180700, y: 476500 }, placement), placement);
  return Math.max(Math.abs(back.x - 2180700), Math.abs(back.y - 476500));
}
check('Преобразование: ENU → местные метры возвращает вершину', () => {
  expect(backAndForth(0)).toBeLessThanOrEqual(1e-6);
});
check('Преобразование: то же с поворотом 33°', () => {
  expect(backAndForth(33)).toBeLessThanOrEqual(1e-6);
});

check('Габарит на карте при масштабе 0,001', () => {
  expect(formatLength(sizeOnMap({ source: sampleContour(), scale: 0.001 }).width, 2)).toBe(
    '0,90\u00A0м',
  );
});
check('Азимут оси +Y при повороте −90°', () => {
  expect(formatDegrees(azimuthY(-90), 0)).toBe('90°');
});
check('Азимут оси +Y при повороте 37°', () => {
  expect(formatDegrees(azimuthY(37), 0)).toBe('323°');
});
check('Угол по положению ручки: восток даёт −90°', () => {
  expect(formatDegrees(rotationFromEnu({ e: 100, n: 0 }), 0)).toBe('−90°');
});
check('Ручка не ближе 15 м даже у крошечного контура', () => {
  // В прототипе функция берёт состояние; здесь — радиус габарита на карте (радиус 1 × масштаб 1).
  expect(formatLength(handleDistance(1), 0)).toBe('15\u00A0м');
});

// Цепочка прототипа: загрузка, поворот на 30°, сдвиг на 100 м к востоку, каждый шаг со снимком.
function edited(): { start: Session; moved: Session } {
  const start = loadContour(createSession(), sampleContour(), ANCHOR);
  const rotated = rotateBy(snapshot(start), 30);
  return { start, moved: moveBy(snapshot(rotated), 100, 0) };
}
// После двух отмен и одного повтора.
const replayed = (): Session => redo(undo(undo(edited().moved)));
function overflowed(): { before: number; after: number } {
  let s = replayed();
  const before = s.undoStack.length;
  for (let k = 0; k < 150; k += 1) s = rotateBy(snapshot(s), 1);
  return { before, after: s.undoStack.length };
}

check('История: два действия — два снимка', () => {
  const { start, moved } = edited();
  expect(moved.undoStack.length - start.undoStack.length).toBe(2);
});
check('История: отмена вернула сдвиг', () => {
  const { moved } = edited();
  expect(undo(moved).anchor?.lon === moved.anchor?.lon).toBe(false);
});
check('История: поворот ещё на месте', () => {
  expect(undo(edited().moved).rotation).toBe(30);
});
check('История: вторая отмена вернула поворот', () => {
  expect(undo(undo(edited().moved)).rotation).toBe(0);
});
check('История: возврат вернул поворот', () => {
  expect(replayed().rotation).toBe(30);
});
check('История: глубина ограничена сотней', () => {
  expect(overflowed().after).toBe(100);
});
check('История: до переполнения снимков было меньше', () => {
  expect(overflowed().before < 100).toBe(true);
});

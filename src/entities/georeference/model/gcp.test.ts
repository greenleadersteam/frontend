import { expect } from 'vitest';

import { enuFrame, enuToGeodetic, vincentyInverse } from '@/shared/lib/geodesy';
import type { GcpPair, GcpStats, Placement, Solution } from '@/shared/lib/georeference';
import {
  formatLength,
  isLocked,
  isOutlier,
  snapToContour,
  solve,
  stats,
  tolerance,
  verdict,
  vertexLatLon,
} from '@/shared/lib/georeference';
import { portedGroup, sampleContour } from '@/shared/lib/test';

import type { GeoreferenceState } from '../lib/export';
import { buildExport } from '../lib/export';
import type { Session } from './session';
import {
  addGcp,
  applyGcp,
  createSession,
  loadContour,
  redo,
  restoreManual,
  snapshot,
  undo,
  updateSession,
} from './session';

// Группа «Опорные точки» прототипа (../geojson/tests.html:1366-1661): 34 проверки. Сценарии
// передачи управления точкам в прототипе идут по общему GP.store; здесь каждый начинает с чистой
// сессии.
const { check } = portedGroup(34);

const TRUE = { anchor: { lat: 55.7431, lon: 37.5908 }, rotation: 33.75, scale: 1 };
const trueState = (): Placement => ({ source: sampleContour(), ...TRUE });

type PairOptions = { errE?: number; errN?: number; enabled?: boolean; control?: boolean };

// Точка-пара из вершины контура: куда её кладёт известное подобие, плюс, если нужно, внесённая
// ошибка в метрах.
function pair(index: number, options: PairOptions = {}): GcpPair {
  const v = sampleContour().vertices[index];
  if (v === undefined) throw new Error(`нет вершины ${String(index)}`);
  const ll = vertexLatLon(v, trueState());
  const g = enuFrame(ll).toGeodetic({ e: options.errE ?? 0, n: options.errN ?? 0, u: 0 });
  return {
    id: `p${String(index)}`,
    n: index + 1,
    x: v.x,
    y: v.y,
    lat: g.lat,
    lon: g.lon,
    kind: 'vertex',
    enabled: options.enabled ?? true,
    control: options.control ?? false,
  };
}

function solved(list: GcpPair[]): {
  state: GeoreferenceState;
  solution: Solution;
  stats: GcpStats;
} {
  const source = sampleContour();
  const solution = solve(source, list);
  if (solution === null) throw new Error('решения нет');
  const state: GeoreferenceState = {
    source,
    anchor: solution.anchor,
    rotation: solution.rotation,
    scale: solution.scale,
    gcp: list,
    workScale: 500,
  };
  return { state, solution, stats: stats(state, list, 500) };
}

const FIVE = [0, 1, 3, 5, 7];
// Вершина, в которую вносится грубая ошибка. Выбрана та, где вес точки в решении невелик: ошибка
// остаётся в невязке, а не растворяется в параметрах. Обратный случай проверяется отдельно.
const BLUNDER = 3;
const HEAVY = 5; // вершина с большим весом: ошибка размазывается

const clean = (): GcpPair[] => FIVE.map((i) => pair(i));
const withBlunder = (extra: PairOptions = {}): GcpPair[] =>
  FIVE.map((i) => (i === BLUNDER ? pair(i, { errE: 5, ...extra }) : pair(i)));

check('Две пары: невязка нулевая', () => {
  expect(solved([pair(0), pair(3)]).stats.rms).toBeLessThanOrEqual(1e-5);
});
check('Две пары: угол восстановлен точно', () => {
  expect(
    Math.abs(solved([pair(0), pair(3)]).solution.rotation - TRUE.rotation),
  ).toBeLessThanOrEqual(1e-6);
});
check('Две пары: поднято предупреждение о тождественно нулевой невязке', () => {
  expect(solved([pair(0), pair(3)]).stats.exact).toBe(true);
});

check('Пять пар: восстановленный масштаб', () => {
  expect(Math.abs(solved(clean()).solution.scale - TRUE.scale)).toBeLessThanOrEqual(1e-6);
});
check('Пять пар: восстановленный угол', () => {
  expect(Math.abs(solved(clean()).solution.rotation - TRUE.rotation)).toBeLessThanOrEqual(1e-4);
});
check('Пять пар: восстановленная опорная точка', () => {
  expect(
    vincentyInverse(TRUE.anchor, solved(clean()).solution.anchor).distance,
  ).toBeLessThanOrEqual(1e-3);
});
check('Пять пар: предупреждения о точном решении нет', () => {
  expect(solved(clean()).stats.exact).toBe(false);
});

check('Отключение подозрительной точки меняет параметры', () => {
  const all = solved(withBlunder()).solution;
  const less = solved(withBlunder({ enabled: false })).solution;
  expect(Math.abs(all.rotation - less.rotation)).toBeGreaterThanOrEqual(1e-4);
});
check('Включение обратно возвращает прежние параметры', () => {
  const before = solved(withBlunder()).solution;
  solved(withBlunder({ enabled: false }));
  const after = solved(withBlunder()).solution;
  expect(
    Math.max(
      Math.abs(before.rotation - after.rotation),
      Math.abs(before.scale - after.scale) * 1e6,
    ),
  ).toBeLessThanOrEqual(0);
});
check('Выключенная грубая точка перестаёт портить решение', () => {
  const less = solved(withBlunder({ enabled: false })).solution;
  const blunder = pair(BLUNDER);
  const pure = solved(clean().filter((p) => p.x !== blunder.x || p.y !== blunder.y)).solution;
  expect(
    Math.max(Math.abs(less.rotation - pure.rotation), Math.abs(less.scale - pure.scale)),
  ).toBeLessThanOrEqual(1e-12);
});
check('Отключённая точка не влияет на решение вовсе', () => {
  const withOff = solved([...clean(), pair(9, { errE: 5, enabled: false })]).solution;
  const without = solved(clean()).solution;
  expect(
    Math.max(
      Math.abs(withOff.rotation - without.rotation),
      Math.abs(withOff.scale - without.scale),
    ),
  ).toBeLessThanOrEqual(1e-12);
});

const withControl = () => solved([...clean(), pair(9, { errE: 5, control: true })]);

check('Контрольная точка не влияет на параметры', () => {
  const a = withControl().solution;
  const b = solved(clean()).solution;
  expect(
    Math.max(Math.abs(a.rotation - b.rotation), Math.abs(a.scale - b.scale)),
  ).toBeLessThanOrEqual(1e-12);
});
check('Невязка контрольной точки считается и равна внесённой ошибке', () => {
  const control = withControl().stats.rows.find((x) => x.control);
  expect(Math.abs((control?.dS ?? NaN) - 5)).toBeLessThanOrEqual(1e-3);
});
check('Контрольная точка не попадает в RMS учтённых', () => {
  expect(withControl().stats.rms).toBeLessThanOrEqual(1e-5);
});
check('Контрольные точки считаются отдельно', () => {
  const summary = withControl().stats;
  expect([summary.usedCount, summary.controlCount, summary.disabledCount].join('/')).toBe('5/1/0');
});

check('Ошибка 5 м в одной точке поднимает RMS', () => {
  const rms = solved(withBlunder()).stats.rms;
  expect(rms).toBeGreaterThanOrEqual(1);
  expect(rms).toBeLessThanOrEqual(3);
});
check('Виновная точка — наибольшая невязка и единственный выброс', () => {
  const r = solved(withBlunder());
  const sorted = [...r.stats.rows].sort((a, c) => c.dS - a.dS);
  const flagged = r.stats.rows.filter((x) => isOutlier(x, r.stats));
  expect(
    [sorted[0]?.pair.n, flagged.length, flagged.length ? flagged[0]?.pair.n : '-'].join('/'),
  ).toBe([BLUNDER + 1, 1, BLUNDER + 1].join('/'));
});

const heavy = () => solved(FIVE.map((i) => pair(i, i === HEAVY ? { errE: 5 } : {})));

check('Ошибка в точке с большим весом не отделяется как выброс', () => {
  const r = heavy();
  expect(r.stats.rows.filter((x) => isOutlier(x, r.stats))).toHaveLength(0);
});
check('Но такая ошибка всё равно выводит RMS за допуск', () => {
  const r = heavy();
  expect(`${r.stats.verdict}/${String(r.stats.rms > r.stats.tolerance)}`).toBe('bad/true');
});
check('На чистых данных выбросов нет', () => {
  const r = solved(clean());
  expect(r.stats.rows.filter((x) => isOutlier(x, r.stats))).toHaveLength(0);
});

check('Положение задаётся точками начиная с двух учтённых', () => {
  expect(
    [
      isLocked([pair(0)]),
      isLocked([pair(0), pair(3)]),
      isLocked([pair(0), pair(3, { control: true })]),
    ].join('/'),
  ).toBe('false/true/false');
});
check('Допуск: 0,3 мм в масштабе работ', () => {
  expect(`${formatLength(tolerance(500), 2)} / ${formatLength(tolerance(2000), 2)}`).toBe(
    '0,15\u00A0м / 0,60\u00A0м',
  );
});
check('Светофор по допуску', () => {
  expect([verdict(0.1, 0.15), verdict(0.14, 0.15), verdict(0.2, 0.15)].join('/')).toBe(
    'ok/warn/bad',
  );
});

const project = ({ x, y }: { x: number; y: number }) => ({
  x: (x - 2180000) * 0.5,
  y: -(y - 476000) * 0.5,
});

check('Притяжение: вершина ближе 12 пикселей', () => {
  const snap = snapToContour(sampleContour(), project, { x: 10, y: 0 });
  expect(`${String(snap?.kind)} ${String(snap?.x)} ${String(snap?.y)}`).toBe(
    'vertex 2180000 476000',
  );
});
check('Притяжение: дальше 12 пикселей — точка на ребре', () => {
  const snap = snapToContour(sampleContour(), project, { x: 225, y: 0 });
  expect(`${String(snap?.kind)} ${String(snap?.x)} ${String(snap?.y)}`).toBe('edge 2180450 476000');
});

// Сценарий: контур совмещён руками, затем ставятся две пары.
const MANUAL = { lat: 55.7512, lon: 37.6184, rotation: 3 };

function handoffScenario(goalShiftE = -40): Session {
  const manualAnchor = { lat: MANUAL.lat, lon: MANUAL.lon };
  let s = updateSession(loadContour(createSession(), sampleContour(), manualAnchor), {
    rotation: MANUAL.rotation,
  });
  const g = enuToGeodetic({ e: goalShiftE, n: 25, u: 0 }, manualAnchor);
  const goal: Placement = {
    source: sampleContour(),
    anchor: { lat: g.lat, lon: g.lon },
    rotation: 11,
    scale: 1,
  };
  for (const i of [0, 2]) {
    const v = sampleContour().vertices[i];
    if (v === undefined) throw new Error(`нет вершины ${String(i)}`);
    const ll = vertexLatLon(v, goal);
    s = applyGcp(addGcp(snapshot(s), { x: v.x, y: v.y, lat: ll.lat, lon: ll.lon, kind: 'vertex' }));
  }
  return s;
}

function atManual(s: Session): boolean {
  return (
    s.anchor !== null &&
    Math.abs(s.rotation - MANUAL.rotation) < 1e-9 &&
    vincentyInverse(MANUAL, s.anchor).distance < 1e-6
  );
}

check('Вторая пара запоминает отброшенное ручное положение', () => {
  const h = handoffScenario().handoff;
  expect(h && [h.count, h.rotation, Math.round(h.shift), h.big].join('/')).toBe('2/3/47/false');
});
check('Ctrl+Z после второй пары возвращает ручное совмещение целиком', () => {
  const s = undo(handoffScenario());
  expect([atManual(s), s.gcp.length, s.handoff === null].join('/')).toBe('true/1/true');
});
check('Повтор после отмены снова применяет решение', () => {
  const s = redo(undo(handoffScenario()));
  expect(`${String(Math.abs(s.rotation - 11) < 1e-6)}/${String(s.handoff !== null)}`).toBe(
    'true/true',
  );
});
check('«Вернуть ручное»: положение вернулось, точки выключены, но остались', () => {
  const s = restoreManual(handoffScenario());
  expect(
    [atManual(s), s.gcp.length, s.gcp.filter((p) => p.enabled).length, isLocked(s.gcp)].join('/'),
  ).toBe('true/2/0/false');
});
check('«Вернуть ручное» тоже отменяется', () => {
  expect(Math.abs(undo(restoreManual(handoffScenario())).rotation - 11) < 1e-6).toBe(true);
});
check('Смещение больше габарита помечено как подозрительное', () => {
  expect(handoffScenario(5000).handoff?.big).toBe(true);
});
check('Новый контур сбрасывает точки прежнего файла', () => {
  const s = loadContour(handoffScenario(), sampleContour(), { lat: MANUAL.lat, lon: MANUAL.lon });
  expect([s.gcp.length, s.handoff === null].join('/')).toBe('0/true');
});

const DATE = new Date(2026, 8, 24, 10, 0, 0);

check('Выгрузка: блок опорных точек с флагами', () => {
  const exported = buildExport(withControl().state, DATE);
  if (!exported.ok) throw new Error('выгрузка не прошла самопроверку');
  const rows = exported.value.опорные_точки;
  const control = rows.find((x) => x.контрольная);
  expect(
    [rows.length, rows.filter((x) => x.учитывается).length, Math.round(control?.dS ?? NaN)].join(
      '/',
    ),
  ).toBe('6/5/5');
});
check('Выгрузка: оценка точности с вердиктом', () => {
  const exported = buildExport(solved(withBlunder()).state, DATE);
  if (!exported.ok) throw new Error('выгрузка не прошла самопроверку');
  const q = exported.value.оценка_точности;
  expect(
    `${q.масштаб_работ} / ${String(q.допуск_м)} / ${q.вердикт} / ${String(q.учтённых_точек)}`,
  ).toBe('1:500 / 0.15 / вне допуска / 5');
});

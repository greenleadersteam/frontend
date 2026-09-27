import { expect } from 'vitest';

import { enuFrame, vincentyInverse } from '@/shared/lib/geodesy';
import { contourOf, portedGroup } from '@/shared/lib/test';

import type { GcpPair } from './gcp';
import { solve } from './gcp';
import { normalizeAngle, vertexLatLon } from './placement';

// Группа «Устойчивость к ошибке клика» прототипа (../geojson/tests.html:1666-1852): 12 проверок.
// Монте-Карло, 1000 повторов на ячейку с фиксированным зерном: шум только на карточной стороне
// пары, подгонка тем же solve, что в приложении. Пометка .slow в имени — для выноса в отдельный
// скрипт test:slow, если прогон станет дольше 10 с; сейчас он идёт около 0,2 с.
const { check } = portedGroup(12);

// Участок А из examples/ (__fixtures__/участок-А-простой.geojson) константой, как в прототипе.
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
const MPP = 1.3; // метров на пиксель
const TRIALS = 1000;
const NS = [2, 3, 4, 6];
const SIGMAS = [0.5, 1, 2, 3, 5];
// Вершины (от юго-западного угла): 0 — угол, 1 — юго-восточный угол, 6 — верх справа,
// 10 — запад; 7–10 — северо-западный угол.
const SPREAD = [0, 1, 6, 10];
const CLUSTER = [7, 8, 9, 10];

const source = contourOf({ type: 'Polygon', coordinates: [RING_A] }, 'участок-А');
const truth = { source, anchor: { lat: 55.7431, lon: 37.5908 }, rotation: 23, scale: 1 };

// mulberry32: числа не пляшут от прогона к прогону.
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Бокс — Мюллер.
function gauss(r: () => number): number {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}
function pick(r: () => number, n: number, k: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let j = 0; j < k; j += 1) {
    const m = j + Math.floor(r() * (n - j));
    const t = a[j] ?? j;
    a[j] = a[m] ?? m;
    a[m] = t;
  }
  return a.slice(0, k);
}

type Trial = { pos: number; rot: number };

function trial(r: () => number, idx: readonly number[], sigmaPx: number): Trial {
  const s = sigmaPx * MPP;
  const pairs = idx.map((i, k): GcpPair => {
    const v = source.vertices[i];
    if (v === undefined) throw new Error(`нет вершины ${String(i)}`);
    const ll = vertexLatLon(v, truth);
    // Порядок вызовов gauss — восток, затем север, как в прототипе: от него зависит ряд чисел.
    const g = s ? enuFrame(ll).toGeodetic({ e: gauss(r) * s, n: gauss(r) * s, u: 0 }) : ll;
    return {
      id: `p${String(k)}`,
      n: k + 1,
      x: v.x,
      y: v.y,
      lat: g.lat,
      lon: g.lon,
      kind: 'vertex',
      enabled: true,
      control: false,
    };
  });
  const sol = solve(source, pairs);
  if (sol === null) throw new Error('решения нет');
  return {
    pos: vincentyInverse(truth.anchor, sol.anchor).distance,
    rot: Math.abs(normalizeAngle(sol.rotation - truth.rotation)),
  };
}

type Summary = { posRms: number; pos95: number; rotRms: number; rot95: number };

function summarize(list: readonly Trial[]): Summary {
  const rms = (k: keyof Trial) =>
    Math.sqrt(list.reduce((a, x) => a + x[k] * x[k], 0) / list.length);
  const p95 = (k: keyof Trial) => {
    const v = list.map((x) => x[k]).sort((a, c) => a - c);
    return v[Math.ceil(0.95 * v.length) - 1] ?? NaN;
  };
  return { posRms: rms('pos'), pos95: p95('pos'), rotRms: rms('rot'), rot95: p95('rot') };
}

// Измерение одно на все проверки: оно детерминировано, а пересчёт стоит 22 000 подгонок.
let cells: Map<string, Summary> | null = null;
function measure(): Map<string, Summary> {
  if (cells !== null) return cells;
  const measured = new Map<string, Summary>();
  const r = rng(20260924);
  for (const n of NS) {
    for (const sg of SIGMAS) {
      const list = [];
      for (let k = 0; k < TRIALS; k += 1) {
        list.push(trial(r, pick(r, source.vertices.length, n), sg));
      }
      measured.set(`${String(n)}/${String(sg)}`, summarize(list));
    }
  }
  const r2 = rng(20260925);
  for (const [name, idx] of [
    ['spread', SPREAD],
    ['cluster', CLUSTER],
  ] as const) {
    const list = [];
    for (let k = 0; k < TRIALS; k += 1) list.push(trial(r2, idx, 1));
    measured.set(name, summarize(list));
  }
  cells = measured;
  return measured;
}
function cell(key: string): Summary {
  const found = measure().get(key);
  if (found === undefined) throw new Error(`нет ячейки ${key}`);
  return found;
}

const rising = (values: readonly number[]) =>
  values.every((v, i) => i === 0 || v > (values[i - 1] ?? v));
const falling = (values: readonly number[]) =>
  values.every((v, i) => i === 0 || v < (values[i - 1] ?? v));

check('σ = 0: ошибка нулевая при N = 2, 3, 4, 6', () => {
  const r = rng(20260926);
  let pos = 0;
  let rot = 0;
  for (const n of NS) {
    for (let k = 0; k < 50; k += 1) {
      const x = trial(r, pick(r, source.vertices.length, n), 0);
      pos = Math.max(pos, x.pos);
      rot = Math.max(rot, x.rot);
    }
  }
  expect(pos).toBeLessThanOrEqual(1e-6);
  expect(rot).toBeLessThanOrEqual(1e-6);
});

for (const n of NS) {
  check(`Ошибка растёт с σ при N = ${String(n)}`, () => {
    const row = SIGMAS.map((sg) => cell(`${String(n)}/${String(sg)}`));
    expect(rising(row.map((x) => x.posRms)), 'положение').toBe(true);
    expect(rising(row.map((x) => x.rotRms)), 'поворот').toBe(true);
  });
}

for (const sg of SIGMAS) {
  check(`Ошибка убывает с N при σ = ${String(sg)} пикс`, () => {
    const column = NS.map((n) => cell(`${String(n)}/${String(sg)}`));
    expect(falling(column.map((x) => x.posRms)), 'положение').toBe(true);
    expect(falling(column.map((x) => x.rotRms)), 'поворот').toBe(true);
  });
}

check('N = 2, σ = 1 пикс: RMS ошибки положения', () => {
  expect(cell('2/1').posRms).toBeLessThanOrEqual(5);
});

check('Разнесённые точки дают меньшую ошибку поворота, чем сгруппированные', () => {
  expect(cell('spread').rotRms).toBeLessThan(cell('cluster').rotRms);
});

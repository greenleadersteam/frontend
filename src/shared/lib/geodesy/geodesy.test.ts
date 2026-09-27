import { expect } from 'vitest';

import { portedGroup } from '@/shared/lib/test';

import type { Geodetic, LatLon, LocalPoint } from './geodesy';
import {
  ecefToGeodetic,
  enuToGeodetic,
  fitSimilarity,
  geodeticToEcef,
  geodeticToEnu,
  similarity,
  toMercator,
  vincentyDirect,
  WGS84,
} from './geodesy';

// Группа «Геодезия» прототипа (../geojson/tests.html:389-663): 37 проверок, допуски без изменений.
const { check } = portedGroup(37);

const D = Math.PI / 180;

const ANCHORS = [
  { name: 'Москва', lat: 55.7558, lon: 37.6173 },
  { name: 'Мурманск', lat: 68.9585, lon: 33.0827 },
  { name: 'Сочи', lat: 43.5855, lon: 39.7231 },
  { name: 'Норильск', lat: 69.3558, lon: 88.1893 },
  { name: 'экватор', lat: 0, lon: 0 },
  { name: '84°', lat: 84, lon: 10 },
  { name: 'южное полушарие', lat: -33.8688, lon: 151.2093 },
];

// Невыпуклый пятиугольник в метрах условной системы координат.
const PENTAGON = [
  [0, 0],
  [1200, 150],
  [640, 620],
  [1320, 1500],
  [-180, 980],
].map(([x = 0, y = 0]) => ({ x, y }));
// Площадка около километра — для сравнения ENU с Меркатором.
const PLOT = [
  [0, 0],
  [1000, 0],
  [1000, 1000],
  [500, 600],
  [0, 1000],
].map(([x = 0, y = 0]) => ({ x, y }));
const AZ8 = [0, 45, 90, 135, 180, 225, 270, 315];

function centroid(ring: readonly LocalPoint[]): LocalPoint {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ring.length, y: y / ring.length };
}

// Худшее значение по всем опорным точкам вместе с её названием: название уходит в сообщение
// упавшей проверки.
function worst() {
  let value = -Infinity;
  let who = '';
  return {
    put(v: number, name: string) {
      if (v > value) {
        value = v;
        who = name;
      }
    },
    atMost(tolerance: number) {
      expect(value, who).toBeLessThanOrEqual(tolerance);
    },
  };
}

function place(ring: readonly LocalPoint[], anchor: LatLon, rotationDeg: number): Geodetic[] {
  const c = centroid(ring);
  return ring.map((p) => {
    const s = similarity(p, { originX: c.x, originY: c.y, rotationDeg, scale: 1 });
    return enuToGeodetic(s, anchor);
  });
}
function measure(point: LatLon, anchor: LatLon): LocalPoint {
  const p = geodeticToEnu({ lat: point.lat, lon: point.lon, h: 0 }, anchor);
  return { x: p.e, y: p.n };
}

check('1. Геодезические → ECEF → геодезические, четыре высоты', () => {
  const w = worst();
  for (const a of ANCHORS) {
    for (const h of [0, 137.5, -25, 3000]) {
      const back = ecefToGeodetic(geodeticToEcef({ lat: a.lat, lon: a.lon, h }));
      const errLat = Math.abs(back.lat - a.lat) * D * WGS84.A;
      const errLon = Math.abs(back.lon - a.lon) * D * WGS84.A * Math.cos(a.lat * D);
      w.put(Math.max(errLat, errLon, Math.abs(back.h - h)), a.name);
    }
  }
  w.atMost(1e-6);
});

for (const d of [0, 1, 500, 5000, 20000, 100000]) {
  check(`2. ENU → геодезические → ENU с высотой, смещение ${String(d)} м`, () => {
    const w = worst();
    for (const a of ANCHORS) {
      for (const az of AZ8) {
        const e = d * Math.sin(az * D);
        const n = d * Math.cos(az * D);
        const p = enuToGeodetic({ e, n }, a);
        const back = geodeticToEnu(p, a);
        w.put(Math.max(Math.abs(back.e - e), Math.abs(back.n - n), Math.abs(back.u)), a.name);
      }
    }
    w.atMost(1e-6);
  });
}

for (const [radius, tolerance] of [
  [500, 1e-4],
  [2000, 1e-3],
  [5000, 0.01],
  [20000, 0.2],
] as const) {
  check(`3. Цена уплощения: высота отброшена, радиус площадки ${String(radius)} м`, () => {
    const w = worst();
    for (const a of ANCHORS) {
      for (const az of AZ8) {
        const e = radius * Math.sin(az * D);
        const n = radius * Math.cos(az * D);
        const p = enuToGeodetic({ e, n }, a);
        const back = geodeticToEnu({ lat: p.lat, lon: p.lon, h: 0 }, a);
        w.put(Math.hypot(back.e - e, back.n - n), a.name);
      }
    }
    w.atMost(tolerance);
  });
}

for (const [s, tolerance] of [
  [100, 1e-3],
  [1000, 1e-3],
  [5000, 0.02],
  [20000, 0.5],
] as const) {
  check(`4. Сверка с Vincenty, 24 азимута, расстояние ${String(s)} м`, () => {
    const w = worst();
    for (const a of ANCHORS) {
      for (let k = 0; k < 24; k += 1) {
        const az = k * 15;
        const mine = enuToGeodetic({ e: s * Math.sin(az * D), n: s * Math.cos(az * D) }, a);
        const ref = vincentyDirect(a, az, s);
        const a1 = geodeticToEnu({ lat: mine.lat, lon: mine.lon, h: 0 }, a);
        const a2 = geodeticToEnu({ lat: ref.lat, lon: ref.lon, h: 0 }, a);
        w.put(Math.hypot(a1.e - a2.e, a1.n - a2.n), a.name);
      }
    }
    w.atMost(tolerance);
  });
}

check('5. Квадрат 1000 × 1000 м: отклонение стороны, померенной обратно', () => {
  const w = worst();
  for (const a of ANCHORS) {
    const corners = [
      [-500, -500],
      [500, -500],
      [500, 500],
      [-500, 500],
    ].map(([e = 0, n = 0]) => enuToGeodetic({ e, n }, a));
    corners.forEach((corner, i) => {
      const next = corners[(i + 1) % 4] ?? corner;
      const p = measure(corner, a);
      const q = measure(next, a);
      w.put(Math.abs(Math.hypot(q.x - p.x, q.y - p.y) - 1000), a.name);
    });
  }
  w.atMost(0.002);
});

for (const rot of [0, 37, 123, 270, -15.5]) {
  check(`6. Пятиугольник, поворот ${String(rot)}°: все попарные расстояния`, () => {
    const w = worst();
    for (const a of ANCHORS) {
      const placed = place(PENTAGON, a, rot).map((p) => measure(p, a));
      PENTAGON.forEach((pi, i) => {
        PENTAGON.forEach((pj, j) => {
          if (j <= i) return;
          const qi = placed[i] ?? pi;
          const qj = placed[j] ?? pj;
          const src = Math.hypot(pi.x - pj.x, pi.y - pj.y);
          const got = Math.hypot(qi.x - qj.x, qi.y - qj.y);
          w.put(Math.abs(got - src), a.name);
        });
      });
    }
    w.atMost(0.005);
  });
}

// Азимут короткого отрезка — плохо обусловленная величина: он равен поперечному сдвигу, делённому
// на длину базы. Один ulp долготы (7·10⁻¹⁵ градуса) на базе 10 м даёт уже 1,6·10⁻⁹ градуса, то есть
// на такой базе допуск 1·10⁻⁹ лежит ниже разрядной сетки double. Поэтому азимут меряется на базе
// от километра, а близкие точки проверяются напрямую: отклонение долготы от меридиана
// и поперечный сдвиг. Обе величины обусловлены хорошо.

function axisY(kind: 'azimuth' | 'lon' | 'cross') {
  const w = worst();
  for (const a of ANCHORS) {
    for (const d of [10, 100, 1000, 20000]) {
      const s = similarity({ x: 0, y: d }, { originX: 0, originY: 0, rotationDeg: 0, scale: 1 });
      const p = enuToGeodetic(s, a);
      if (kind === 'lon') {
        w.put(Math.abs(p.lon - a.lon), a.name);
        continue;
      }
      if (kind === 'cross') {
        w.put(Math.abs(geodeticToEnu({ lat: p.lat, lon: p.lon, h: 0 }, a).e), a.name);
        continue;
      }
      if (d < 1000) continue;
      const f1 = a.lat * D;
      const f2 = p.lat * D;
      const dl = (p.lon - a.lon) * D;
      let br =
        Math.atan2(
          Math.sin(dl) * Math.cos(f2),
          Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl),
        ) / D;
      if (br > 180) br -= 360;
      if (br < -180) br += 360;
      w.put(Math.abs(br), a.name);
    }
  }
  return w;
}

check('7. При повороте 0° азимут локальной оси +Y, база 1 и 20 км', () => {
  axisY('azimuth').atMost(1e-9);
});
check('7. Ось +Y лежит на меридиане опорной точки: отклонение долготы', () => {
  axisY('lon').atMost(1e-12);
});
check('7. Поперечный сдвиг оси +Y, базы от 10 м до 20 км', () => {
  axisY('cross').atMost(1e-8);
});

function fitSynthetic() {
  const c = centroid(PENTAGON);
  const known = { originX: c.x, originY: c.y, rotationDeg: 33.75, scale: 1 };
  const dst = PENTAGON.map((p) => {
    const s = similarity(p, known);
    return { x: s.e + 412345.678, y: s.n - 98765.4321 };
  });
  const fit = fitSimilarity(PENTAGON, dst);
  if (fit === null) throw new Error('подгонка не сошлась');
  return fit;
}

check('8. Подгонка синтетики: восстановленный масштаб', () => {
  expect(Math.abs(fitSynthetic().scale - 1)).toBeLessThanOrEqual(1e-7);
});
check('8. Подгонка синтетики: восстановленный угол', () => {
  expect(Math.abs(fitSynthetic().rotationDeg - 33.75)).toBeLessThanOrEqual(1e-4);
});
check('8. Подгонка синтетики: невязка RMS', () => {
  expect(fitSynthetic().rms).toBeLessThanOrEqual(1e-3);
});
check('8. Одна пара: только сдвиг, масштаб 1, поворот 0°', () => {
  const one = fitSimilarity([{ x: 10, y: 20 }], [{ x: 110, y: 220 }]);
  expect(one && [one.tx, one.ty, one.scale, one.rotationDeg].join(' ')).toBe('100 200 1 0');
});
check('8. Две пары: точное решение, поворот 90°', () => {
  const two = fitSimilarity(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    [
      { x: 10, y: 10 },
      { x: 10, y: 110 },
    ],
  );
  expect(
    two !== null &&
      two.rms === 0 &&
      Math.abs(two.rotationDeg - 90) < 1e-12 &&
      Math.abs(two.scale - 1) < 1e-12,
  ).toBe(true);
});
check('8. Все точки совпали: null вместо NaN', () => {
  const same = { x: 5, y: 5 };
  expect(
    fitSimilarity(
      [same, same, same],
      [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
        { x: 5, y: 6 },
      ],
    ),
  ).toBeNull();
});

function mercatorVsEnu() {
  const enu = worst();
  let lo = Infinity;
  let hi = -Infinity;
  let ratio = Infinity;
  for (const a of ANCHORS) {
    const pts = place(PLOT, a, 20);
    const fitEnu = fitSimilarity(
      PLOT,
      pts.map((p) => measure(p, a)),
    );
    const fitMer = fitSimilarity(
      PLOT,
      pts.map((p) => toMercator(p)),
    );
    if (fitEnu === null || fitMer === null) throw new Error('подгонка не сошлась');
    // Единицы Меркатора переводим в метры на местности: на широте φ они растянуты примерно
    // в 1/cos φ раз.
    const merMeters = fitMer.rms * Math.cos(a.lat * D);
    enu.put(fitEnu.rms, a.name);
    lo = Math.min(lo, merMeters);
    hi = Math.max(hi, merMeters);
    ratio = Math.min(ratio, merMeters / fitEnu.rms);
  }
  return { enu, lo, hi, ratio };
}

check('9. Площадка 1 км: невязка RMS подгонки в ENU', () => {
  mercatorVsEnu().enu.atMost(1e-3);
});
check('9. Та же подгонка в EPSG:3857: невязка RMS, метры на местности', () => {
  const { lo, hi } = mercatorVsEnu();
  expect(lo).toBeGreaterThanOrEqual(0.1);
  expect(hi).toBeLessThanOrEqual(3);
});
check(
  '9. Во сколько раз Меркатор хуже ENU: одномасштабное подобие не поглощает анизотропию',
  () => {
    expect(mercatorVsEnu().ratio).toBeGreaterThanOrEqual(1000);
  },
);

check('10. Меркатор: (0°, 0°) → (0, 0)', () => {
  const m = toMercator({ lat: 0, lon: 0 });
  expect(Math.max(Math.abs(m.x), Math.abs(m.y))).toBeLessThanOrEqual(1e-6);
});
check('10. Меркатор: (0°, 180°) → x = 20 037 508,342789', () => {
  expect(Math.abs(toMercator({ lat: 0, lon: 180 }).x - 20037508.342789)).toBeLessThanOrEqual(1e-3);
});
check('10. Меркатор: (85,0511287798066°, 0°) → y = 20 037 508,342789', () => {
  expect(
    Math.abs(toMercator({ lat: 85.0511287798066, lon: 0 }).y - 20037508.342789),
  ).toBeLessThanOrEqual(1e-3);
});
check('10. Два пути к y: R·ln tg(45° + φ/2) против R·atanh(sin φ)', () => {
  const w = worst();
  for (const a of ANCHORS) {
    const phi = a.lat * D;
    w.put(
      Math.abs(
        WGS84.A * Math.log(Math.tan(Math.PI / 4 + phi / 2)) - WGS84.A * Math.atanh(Math.sin(phi)),
      ),
      a.name,
    );
  }
  w.atMost(1e-6);
});

import { describe, expect, test } from 'vitest';

import { createLocalFrame } from './local-frame';

const R = 6_378_137;
// Обратное к условным lon/lat: прямая формула Web Mercator.
const mercator = ([lon, lat]: [number, number]): [number, number] => [
  ((lon * Math.PI) / 180) * R,
  Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * R,
];

describe('координаты чертежа', () => {
  const frame = createLocalFrame({ minX: 1000, minY: 2000, maxX: 3000, maxY: 4000 }, false);

  test('центр данных — в точке (0, 0)', () => {
    expect(frame.toLocal([2000, 3000])).toEqual([0, 0]);
    expect(frame.toMap([0, 0])).toEqual([0, 0]);
  });

  test('туда и обратно: метры → условные lon/lat → метры', () => {
    const [x, y] = mercator(frame.toMap(frame.toLocal([2750, 3400])));
    expect(x).toBeCloseTo(750, 6);
    expect(y).toBeCloseTo(400, 6);
  });

  // Масштаб Меркатора — 1/cos φ: на 1 км от центра (охват 2 км) это 1 + 1,2·10⁻⁸.
  test('на охвате 2 км масштаб карты — метры с погрешностью меньше 10⁻⁷', () => {
    const [, latTop] = frame.toMap([0, 1000]);
    const scale = 1 / Math.cos((latTop * Math.PI) / 180);
    expect(scale - 1).toBeLessThan(1e-7);
  });
});

describe('WGS84', () => {
  // Участок у Покровки.
  const frame = createLocalFrame({ minX: 37.64, minY: 55.75, maxX: 37.65, maxY: 55.76 }, true);

  // Независимая проверка: радиусы кривизны эллипсоида WGS84 на широте φ — N для параллели
  // и M для меридиана.
  const a = 6_378_137;
  const e2 = 0.00669437999014;
  const phi = (55.755 * Math.PI) / 180;
  const w = 1 - e2 * Math.sin(phi) ** 2;
  const perDegreeLon = ((a / Math.sqrt(w)) * Math.cos(phi) * Math.PI) / 180;
  const perDegreeLat = ((a * (1 - e2)) / w ** 1.5) * (Math.PI / 180);

  test('метры по параллели и меридиану — как на эллипсоиде WGS84, точнее 1 мм на 100 м', () => {
    const [x] = frame.toLocal([37.645 + 100 / perDegreeLon, 55.755]);
    const [, y] = frame.toLocal([37.645, 55.755 + 100 / perDegreeLat]);
    expect(Math.abs(x - 100)).toBeLessThan(0.001);
    expect(Math.abs(y - 100)).toBeLessThan(0.001);
  });

  test('туда и обратно', () => {
    const [lon, lat] = frame.toMap(frame.toLocal([37.6437, 55.7581]));
    expect(lon).toBeCloseTo(37.6437, 10);
    expect(lat).toBeCloseTo(55.7581, 10);
  });
});

test('обратные преобразования: карта → локальные метры → данные возвращают ту же точку', () => {
  for (const geographic of [true, false]) {
    const extent = geographic
      ? { minX: 37.6, minY: 55.7, maxX: 37.62, maxY: 55.71 }
      : { minX: 1000, minY: 2000, maxX: 1060, maxY: 2020 };
    const frame = createLocalFrame(extent, geographic);
    const data = geographic ? [37.6123, 55.7045] : [1012.5, 2007.25];

    const local = frame.toLocal(data);
    const back = frame.toData(frame.fromMap(frame.toMap(local)));

    expect(back[0]).toBeCloseTo(data[0] ?? NaN, 9);
    expect(back[1]).toBeCloseTo(data[1] ?? NaN, 9);
  }
});

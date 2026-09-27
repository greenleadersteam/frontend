import { describe, expect, test } from 'vitest';

import {
  area,
  boundaryIndex,
  isInside,
  type LocalPoint,
  type LocalPolygon,
  nearestOnBoundary,
} from './geometry';

const square = (x: number, y: number, size: number): LocalPoint[] => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
];

const SQUARE: LocalPolygon = [square(0, 0, 10)];
// Кольцо: квадрат 10 × 10 с дырой 4 × 4 в центре.
const RING: LocalPolygon = [square(0, 0, 10), square(3, 3, 4)];

describe('isInside', () => {
  test.each([
    ['внутри квадрата', [5, 5], [SQUARE], true],
    ['снаружи квадрата', [15, 5], [SQUARE], false],
    ['в дыре кольца — снаружи', [5, 5], [RING], false],
    ['в теле кольца — внутри', [1, 5], [RING], true],
    ['во второй части мультиполигона', [25, 5], [SQUARE, [square(20, 0, 10)]], true],
  ] as const)('%s', (_, point, polygons, expected) => {
    expect(isInside(point, polygons)).toBe(expected);
  });
});

describe('nearestOnBoundary', () => {
  test('снаружи квадрата — перпендикуляр к ближней стороне', () => {
    expect(nearestOnBoundary([13, 5], [SQUARE])).toEqual({ point: [10, 5], distance: 3 });
  });

  test('внутри квадрата — до ближней стороны', () => {
    expect(nearestOnBoundary([2, 5], [SQUARE])?.distance).toBeCloseTo(2);
  });

  test('в дыре кольца — до края дыры', () => {
    expect(nearestOnBoundary([5, 4], [RING])).toEqual({ point: [5, 3], distance: 1 });
  });

  test('мультиполигон — ближайшая из частей', () => {
    const nearest = nearestOnBoundary([17, 5], [SQUARE, [square(20, 0, 10)]]);
    expect(nearest).toEqual({ point: [20, 5], distance: 3 });
  });

  test('точка на границе — расстояние 0', () => {
    expect(nearestOnBoundary([10, 4], [SQUARE])?.distance).toBe(0);
  });

  test('угол — ближайшая вершина', () => {
    const nearest = nearestOnBoundary([13, 14], [SQUARE]);
    expect(nearest?.point).toEqual([10, 10]);
    expect(nearest?.distance).toBeCloseTo(5);
  });

  test('исключённые отрезки не учитываются', () => {
    const skipRight = (a: LocalPoint, b: LocalPoint) => a[0] === 10 && b[0] === 10;
    // Без правой стороны ближайшие — углы (10, 0) и (10, 10), оба в √34 м.
    expect(nearestOnBoundary([13, 5], [SQUARE], skipRight)?.distance).toBeCloseTo(Math.sqrt(34));
  });
});

test('площадь: квадрат, кольцо, мультиполигон', () => {
  expect(area([SQUARE])).toBe(100);
  expect(area([RING])).toBe(84);
  expect(area([SQUARE, [square(20, 0, 10)]])).toBe(200);
});

describe('boundaryIndex', () => {
  // Треугольник с длинной диагональю: отрезок проходит через десятки ячеек, в том числе
  // срезая их углы.
  const TRIANGLE: LocalPolygon = [
    [
      [0, 0],
      [37.3, 0],
      [0, 23.9],
      [0, 0],
    ],
  ];
  const near = boundaryIndex([TRIANGLE], 1);

  test.each([
    ['на катете', [12.4, 0.01], true],
    ['у вершины', [37.29, 0.005], true],
    ['на диагонали', [37.3 * 0.37, 23.9 * 0.63], true],
    ['в стороне от диагонали', [37.3 * 0.37 - 0.1, 23.9 * 0.63 - 0.1], false],
    ['внутри', [5, 5], false],
  ] as const)('%s', (_, point, expected) => {
    expect(near(point, 0.02)).toBe(expected);
  });

  test('совпадает с полным перебором границы', () => {
    for (let x = -1; x <= 38; x += 0.37) {
      for (let y = -1; y <= 25; y += 0.29) {
        const onDiagonal: LocalPoint = [x, 23.9 * (1 - x / 37.3) + ((x * 7) % 3) * 0.004];
        for (const point of [onDiagonal, [x, y] as const]) {
          const exact = (nearestOnBoundary(point, [TRIANGLE])?.distance ?? Infinity) <= 0.02;
          expect(near(point, 0.02)).toBe(exact);
        }
      }
    }
  });
});

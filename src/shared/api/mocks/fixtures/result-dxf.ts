import type { LocalPoint } from '@/shared/lib/geometry';

// Радиусы кроны на слое результата — как у бэкенда: ../backend/greenplan/io/dxf_sink.py:20-21.
const CROWN_RADIUS_M = { tree: 1.5, shrub: 0.35 } as const;

type DxfPlanting = { point: LocalPoint; plantType: keyof typeof CROWN_RADIUS_M };

// Минимальный DXF R12 (AC1009): заголовок и по окружности на посадку на слое результата, как
// пишет ../backend/greenplan/io/dxf_sink.py. Таблицу слоёв R12 не требует. Координаты — метры
// чертежа.
export function plantingDxf(plantings: DxfPlanting[]): string {
  const circles = plantings.flatMap(({ point: [x, y], plantType }) => [
    '0',
    'CIRCLE',
    '8',
    'GREENING_PROPOSED',
    '62',
    '3',
    '10',
    x.toFixed(3),
    '20',
    y.toFixed(3),
    '30',
    '0.0',
    '40',
    String(CROWN_RADIUS_M[plantType]),
  ]);
  return [
    '0',
    'SECTION',
    '2',
    'HEADER',
    '9',
    '$ACADVER',
    '1',
    'AC1009',
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    ...circles,
    '0',
    'ENDSEC',
    '0',
    'EOF',
    '',
  ].join('\r\n');
}

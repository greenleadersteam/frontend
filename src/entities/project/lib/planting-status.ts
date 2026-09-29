import { isInside, type LocalPoint } from '@/shared/lib/geometry';

import type { PlantType } from '../model/project';
import { checksAgainstObstacles, type PreparedObstacles } from './obstacle-checks';
import { CROWN_RADIUS_M } from './plan-projection';
import { checksForPlanting, type PreparedZones } from './planting-checks';

// Статус правленой посадки. Его считает клиент: в API версий статусов нет. allowed — нормы
// соблюдены и точка там, где сервис сажает; forbidden — нарушена норма; rejected — нормы
// соблюдены, но точка вне газона в границах участка.
export type PlantingStatus = 'allowed' | 'forbidden' | 'rejected';

// Статус посадки, которую поправили на фронте: теми же проверками, что карточка посадки.
// С объектами подосновы — по расстоянию до них с допуском TOLERANCE_M, без них — по зонам
// запрета (попадание внутрь зоны, с тем же допуском).
export function plantingStatus(
  point: LocalPoint,
  plantType: PlantType,
  prepared: PreparedZones,
  obstacles: PreparedObstacles | null,
): PlantingStatus {
  const forbidden =
    obstacles === null
      ? checksForPlanting(point, plantType, prepared).some(({ kind }) => kind === 'inside')
      : checksAgainstObstacles(point, plantType, undefined, obstacles).some(
          ({ violated }) => violated,
        );
  if (forbidden) return 'forbidden';
  // Допустимая область — газон ∩ граница участка; без неё — газон целиком.
  const site = prepared.baseArea ?? prepared.lawn;
  return site === null || isInside(point, site) ? 'allowed' : 'rejected';
}

type Neighbour = { id: string; point: LocalPoint; plantType: PlantType };

// Кроны пересекаются, если стволы ближе суммы радиусов крон. Это не норма, статус не меняется:
// только предупреждение в карточке. Перебор — для одной выбранной посадки.
export function overlappingCrowns(target: Neighbour, others: Iterable<Neighbour>): number {
  let count = 0;
  for (const other of others) {
    if (other.id === target.id) continue;
    const reach = CROWN_RADIUS_M[target.plantType] + CROWN_RADIUS_M[other.plantType];
    const [x, y] = target.point;
    if (Math.hypot(other.point[0] - x, other.point[1] - y) < reach) count += 1;
  }
  return count;
}

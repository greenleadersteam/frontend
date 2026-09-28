import type { ProposedApiComponents } from '@/shared/api';
import {
  type GcpPair,
  isLocked,
  type Placement,
  stats,
  type WorkScale,
} from '@/shared/lib/georeference';

type ManualGeoreference = ProposedApiComponents['schemas']['ManualGeoreference'];

// Привязка для проекта — тело PUT /georeference контракта-предложения. Опорная точка чертежа —
// центр габарита контура: вокруг него поворот и масштаб, как в Placement. Опорные точки
// передаются, только когда положение задают они: при ручном совмещении контракт ждёт пустой
// список и rms_m = null. Выключенные точки в привязке не участвуют и не передаются.
export function projectGeoreference(
  placement: Placement,
  gcp: readonly GcpPair[],
  workScale: WorkScale,
): ManualGeoreference {
  const byPoints = isLocked(gcp);
  const summary = stats(placement, gcp, workScale);
  return {
    anchor_wgs84: { lat: placement.anchor.lat, lon: placement.anchor.lon },
    anchor_drawing: { x: placement.source.center.x, y: placement.source.center.y },
    rotation_deg: placement.rotation,
    scale: placement.scale,
    method: byPoints ? 'control_points' : 'manual',
    rms_m: byPoints ? summary.rms : null,
    control_points: byPoints
      ? summary.rows
          .filter((row) => row.used || row.control)
          .map(({ pair, dS, used }) => ({
            label: String(pair.n),
            drawing: { x: pair.x, y: pair.y },
            wgs84: { lat: pair.lat, lon: pair.lon },
            residual_m: dS,
            used,
          }))
      : [],
  };
}

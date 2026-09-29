import { zipSync } from 'fflate';

import type { View } from './plan-3d-camera';
import type { Stage } from './plan-3d-stage';

export const VIEWS: readonly View[] = ['overview', 'along', 'pedestrian'];
export const STAGES: readonly Stage[] = ['before', 'after'];

const VIEW_FILES: Record<View, string> = {
  overview: '1-obzor',
  along: '2-vdol-uchastka',
  pedestrian: '3-uroven-peshehoda',
};
const STAGE_FILES: Record<Stage, string> = { before: 'do', after: 'posle' };

// Латиница в именах: архив открывают и в Windows-проводнике, где кириллица в ZIP без флага
// UTF-8 превращается в кракозябры.
const shotName = (view: View, stage: Stage): string =>
  `${VIEW_FILES[view]}-${STAGE_FILES[stage]}.png`;

export type Shot = { view: View; stage: Stage; png: Uint8Array };

// PNG уже сжат: без повторного сжатия архив собирается мгновенно.
export const shotsArchive = (shots: readonly Shot[]): Uint8Array<ArrayBuffer> =>
  zipSync(Object.fromEntries(shots.map(({ view, stage, png }) => [shotName(view, stage), png])), {
    level: 0,
  });

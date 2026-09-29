import { unzipSync } from 'fflate';
import { describe, expect, test } from 'vitest';

import { shotsArchive, STAGES, VIEWS } from './plan-3d-archive';

describe('визуализации: архив', () => {
  test('ZIP — шесть PNG: три ракурса «до» и «после»', () => {
    const shots = VIEWS.flatMap((view) =>
      STAGES.map((stage) => ({ view, stage, png: new Uint8Array([137, 80, 78, 71]) })),
    );

    expect(Object.keys(unzipSync(shotsArchive(shots))).sort()).toEqual([
      '1-obzor-do.png',
      '1-obzor-posle.png',
      '2-vdol-uchastka-do.png',
      '2-vdol-uchastka-posle.png',
      '3-uroven-peshehoda-do.png',
      '3-uroven-peshehoda-posle.png',
    ]);
  });
});

import { describe, expect, test } from 'vitest';

import { hidesFlatPlanting, stageVisibility } from './plan-3d-stage';

describe('«до / после»', () => {
  test('«до» прячет посадки сцены и плана, «после» показывает сцену и не прячет план', () => {
    expect(stageVisibility('before', ['plan-3d-crowns', 'plan-3d-shrubs'])).toEqual([
      ['plan-3d-crowns', false],
      ['plan-3d-shrubs', false],
    ]);
    expect(stageVisibility('after', ['plan-3d-crowns'])).toEqual([['plan-3d-crowns', true]]);
    expect(hidesFlatPlanting('before')).toBe(true);
    expect(hidesFlatPlanting('after')).toBe(false);
  });
});

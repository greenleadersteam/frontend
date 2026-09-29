// Стадия 3D-сцены отдельно от архива: её читает карта плана, а архив тянет за собой fflate.
export type Stage = 'before' | 'after';

// Видимость слоёв сцены на стадии: «до» прячет посадки, «после» показывает. Посадки плана в 2D
// прячет карта по той же стадии (result-map.tsx).
export const stageVisibility = (stage: Stage, scene: readonly string[]): [string, boolean][] =>
  scene.map((layer) => [layer, stage === 'after']);

// «До» прячет и посадки плана: иначе круги посадок видны под «пустым» участком.
export const hidesFlatPlanting = (stage: Stage): boolean => stage === 'before';

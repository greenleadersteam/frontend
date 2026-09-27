import { drawingTransform, plantingLayerDxf } from '@/entities/project';

import type { EditedResult } from './result';

export type EditedDxf =
  | { kind: 'ready'; dxf: string; rms: number | null }
  | { kind: 'mismatch'; rms: number }
  | { kind: 'insufficient' };

// Слой посадок с правками в системе чертежа: вставкой или внешней ссылкой он ложится на
// исходный чертёж. При геопривязке у неизменённых посадок точка чертежа — из /explanation,
// у правленых — через преобразование плана в чертёж.
export function editedDxf({
  geographic,
  edited,
  entries,
  statuses,
}: Pick<EditedResult, 'geographic' | 'edited' | 'entries' | 'statuses'>): EditedDxf {
  const features = edited.planting.features;
  const transform = drawingTransform(features, entries, geographic);
  if (transform.kind === 'mismatch' || transform.kind === 'insufficient') return transform;
  const plantings = features.map(({ geometry, properties }) => {
    // Без геопривязки точка плана и есть точка чертежа, без округления /explanation до
    // сантиметра. С геопривязкой у неизменённых — точка чертежа из /explanation.
    const changed = properties.origin === 'manual' || properties.moved_from !== null;
    const entry = changed ? undefined : entries.get(properties.id);
    const [x = 0, y = 0] =
      transform.kind === 'identity'
        ? geometry.coordinates
        : entry !== undefined
          ? [entry.x, entry.y]
          : transform.toDrawing(geometry.coordinates);
    return {
      x,
      y,
      plantType: properties.plant_type,
      ruleId: properties.rule_id,
      id: properties.id,
      origin: properties.origin,
      status: statuses.get(properties.id) ?? 'allowed',
      speciesId: properties.species_id ?? null,
    };
  });
  return {
    kind: 'ready',
    dxf: plantingLayerDxf(plantings),
    rms: transform.kind === 'fitted' ? transform.rms : null,
  };
}

import {
  type DrawingDxf,
  drawingTransform,
  plantingLayerDxf,
  replacePlantingLayer,
} from '@/entities/project';

import type { EditedResult } from './result';

type Fit = { kind: 'mismatch'; rms: number } | { kind: 'insufficient' };

export type EditedDxf = { kind: 'ready'; dxf: string; rms: number | null } | Fit;

export type EditedDrawing = DrawingDxf | Fit;

type Source = Pick<EditedResult, 'geographic' | 'edited' | 'entries' | 'statuses'>;

// Итоговая расстановка в системе чертежа. При геопривязке у неизменённых посадок точка чертежа —
// из /explanation, у правленых — через преобразование плана в чертёж.
function drawingPlantings({ geographic, edited, entries, statuses }: Source) {
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
    kind: 'ready' as const,
    plantings,
    rms: transform.kind === 'fitted' ? transform.rms : null,
  };
}

// Слой посадок с правками отдельным файлом: вставкой или внешней ссылкой он ложится на исходный
// чертёж.
export function editedDxf(source: Source): EditedDxf {
  const result = drawingPlantings(source);
  if (result.kind !== 'ready') return result;
  return { kind: 'ready', dxf: plantingLayerDxf(result.plantings), rms: result.rms };
}

// Чертёж сервиса с правками: исходные слои — байты сервера, слой результата — итоговая
// расстановка (ТЗ, п. 5, 7: правки — на отдельном слое результата).
export function editedDrawing(source: Source, serverDxf: Uint8Array<ArrayBuffer>): EditedDrawing {
  const result = drawingPlantings(source);
  if (result.kind !== 'ready') return result;
  return replacePlantingLayer(serverDxf, result.plantings);
}

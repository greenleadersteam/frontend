import { describe, expect, test } from 'vitest';

import {
  DRAWING_FIT_LIMIT_M,
  type ExplanationEntry,
  type PlantingFeatureCollection,
} from '@/entities/project';
import type { FinalPlanting } from '@/features/edit-plantings';

import { editedDxf } from './edited-dxf';

const READY_ID = '5c0b7f2e9a3d4e61b8f0c2a7d9e4b1f3';

// Демо-участок с геопривязкой — из моков, как его видит приложение.
async function demoResult() {
  const get = async (path: string): Promise<unknown> =>
    (await fetch(new URL(`/api/projects/${READY_ID}/${path}`, location.origin))).json();
  // Ответы моков — по контракту: сужение на границе теста.
  const planting = (await get('planting')) as PlantingFeatureCollection;
  const explanation = (await get('explanation')) as ExplanationEntry[];
  return { planting, entries: new Map(explanation.map((entry) => [entry.id, entry])) };
}

const circles = (dxf: string) => {
  const lines = dxf.split('\r\n');
  return lines.flatMap((line, index) => {
    if (line !== 'CIRCLE' || lines[index - 1] !== '0') return [];
    const value = (code: string) => {
      const at = lines.indexOf(code, index);
      return lines[at + 1] ?? '';
    };
    return [{ x: Number(value('10')), y: Number(value('20')), id: value('1000') }];
  });
};

describe('слой посадок с правками', () => {
  test('демо-участок: подгонка сходится, перемещённая ложится в систему чертежа', async () => {
    const { planting, entries } = await demoResult();
    const [first, ...rest] = planting.features;
    if (first === undefined) throw new Error('нет посадок');
    const [lon = 0, lat = 0] = first.geometry.coordinates;
    const entry = entries.get(first.properties.id);
    if (entry === undefined) throw new Error('нет обоснования');
    // На 2 м к востоку: у демо-участка чертёж не повёрнут, масштаб 1 — x растёт на 2 м.
    const radians = (lat * Math.PI) / 180;
    const metersPerLon = 111_412.84 * Math.cos(radians) - 93.5 * Math.cos(3 * radians);
    const final: FinalPlanting = {
      ...planting,
      features: [
        {
          ...first,
          geometry: { type: 'Point', coordinates: [lon + 2 / metersPerLon, lat] },
          properties: {
            ...first.properties,
            origin: 'auto',
            moved_from: first.geometry.coordinates,
            species_changed: false,
          },
        },
        ...rest.map((feature) => ({
          ...feature,
          properties: {
            ...feature.properties,
            origin: 'auto' as const,
            moved_from: null,
            species_changed: false,
          },
        })),
      ],
    };

    const layer = editedDxf({
      geographic: true,
      edited: {
        planting: final,
        zones: {
          type: 'FeatureCollection',
          metadata: { crs: '', used_site_boundary: false, uncovered_categories: [] },
          features: [],
        },
      },
      entries,
      statuses: new Map([[first.properties.id, 'forbidden']]),
    });

    if (layer.kind !== 'ready') throw new Error(layer.kind);
    expect(layer.rms).toBeLessThan(DRAWING_FIT_LIMIT_M);
    const drawn = circles(layer.dxf);
    expect(drawn).toHaveLength(planting.features.length);
    const moved = drawn[0];
    expect(moved?.x).toBeCloseTo(entry.x + 2, 1);
    expect(moved?.y).toBeCloseTo(entry.y, 1);
    // Неизменённые — точно по /explanation.
    const second = rest[0];
    const secondEntry = second === undefined ? undefined : entries.get(second.properties.id);
    expect(drawn[1]).toMatchObject({ x: secondEntry?.x, y: secondEntry?.y });
  });
});

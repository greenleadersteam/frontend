import { waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';

import { plantingStatus, type Project } from '@/entities/project';
import { renderHookWithStore } from '@/shared/lib/test';

import { plantingChecks, resultBase, useResultData } from './result';

// «Улица Шаболовка, 37» из моков: готова, без геопривязки, с объектами подосновы.
const PROJECT: Project = {
  id: '0e8d2b6a4c1f47e9a3b5d7c9e1f2a4b6',
  name: 'Улица Шаболовка, 37',
  description: null,
  created_at: '2026-09-19T10:00:00Z',
  updated_at: '2026-09-19T10:00:00Z',
  state: { kind: 'ready' },
  job: { stage: 'ready', progress_pct: 100 },
};

const PLACEMENT = {
  source: { center: { x: 30, y: 8.5 } },
  anchor: { lat: 55.7203, lon: 37.6089 },
  rotation: 23.4,
  scale: 1.013,
};

// Главный принцип ручной привязки: она меняет только путь на карту. Проверки норм и статусы
// считаются в метрах чертежа и не зависят от неё ни на миллиметр.
test('проверки норм и статусы с ручной привязкой — те же числа, что без неё', async () => {
  const { result } = renderHookWithStore(() => useResultData(PROJECT));
  await waitFor(() => {
    expect(result.current.kind).toBe('ready');
  });
  if (result.current.kind !== 'ready') throw new Error('результат не загружен');
  const loaded = result.current.result;
  const plain = resultBase(loaded, null);
  const placed = resultBase(loaded, PLACEMENT);
  if (plain === null || placed === null) throw new Error('охвата нет');
  expect(placed.frame.onCity).toBe(true);
  expect(plain.obstacles).not.toBeNull();

  const features = loaded.data.planting.features;
  expect(features.length).toBeGreaterThan(10);
  for (const feature of features) {
    const entry = plain.entries.get(feature.properties.id);
    // Правленая посадка: проверки считаются клиентом, а не берутся из /explanation.
    const edited = {
      ...feature,
      properties: {
        ...feature.properties,
        origin: 'manual' as const,
        moved_from: null,
        species_changed: false,
      },
    };
    expect(plantingChecks(edited, entry, placed)).toEqual(plantingChecks(edited, entry, plain));

    const [x = 0, y = 0] = feature.geometry.coordinates;
    const shifted = [x + 0.7, y - 1.3];
    const status = (base: typeof plain) =>
      plantingStatus(
        base.frame.toLocal(shifted),
        feature.properties.plant_type,
        base.prepared,
        base.obstacles?.prepared ?? null,
      );
    expect(status(placed)).toBe(status(plain));
  }
});

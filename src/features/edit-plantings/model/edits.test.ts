import { describe, expect, test } from 'vitest';

import type { PlantingFeatureCollection } from '@/entities/project';

import {
  applyDiff,
  countEdits,
  emptyDiff,
  HISTORY_DEPTH,
  manualId,
  plantingEditsActions as actions,
  plantingEditsSlice,
  type PlantingEditsState,
  selectFinalPlanting,
} from './edits';

const reduce = plantingEditsSlice.reducer;
const P = 'project-1';

const source: PlantingFeatureCollection = {
  type: 'FeatureCollection',
  metadata: { crs: 'local' },
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: {
        id: 'T-1',
        plant_type: 'tree',
        rule_id: 'TREE_ROW_CURB',
        species_id: 'tilia_cordata',
        species_reason_ru: 'Крона вписывается в шаг',
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [5, 0] },
      properties: { id: 'S-1', plant_type: 'shrub', rule_id: 'SHRUB_FILL_LAWN' },
    },
  ],
};

const run = (...list: ReturnType<(typeof actions)[keyof typeof actions]>[]) =>
  list.reduce<PlantingEditsState>((state, action) => reduce(state, action), {});

const present = (state: PlantingEditsState) => state[P]?.present;

describe('правки посадок', () => {
  test('переместить, добавить, удалить, сменить породу — в итоговой расстановке', () => {
    const state = run(
      actions.moved({ projectId: P, id: 'T-1', point: [1, 2] }),
      actions.added({
        projectId: P,
        id: 'manual-1',
        point: [9, 9],
        plantType: 'shrub',
        speciesId: null,
      }),
      actions.removed({ projectId: P, id: 'S-1' }),
      actions.speciesChanged({ projectId: P, id: 'T-1', speciesId: 'acer_platanoides' }),
    );
    const final = applyDiff(source, present(state) ?? emptyDiff());

    expect(
      final.features.map(({ properties, geometry }) => [properties.id, geometry.coordinates]),
    ).toEqual([
      ['T-1', [1, 2]],
      ['manual-1', [9, 9]],
    ]);
    expect(final.features[0]?.properties).toMatchObject({
      origin: 'auto',
      moved_from: [0, 0],
      species_id: 'acer_platanoides',
      species_changed: true,
      // Порода сменена — причина выбора сервиса к ней не относится.
      species_reason_ru: null,
    });
    expect(final.features[1]?.properties).toMatchObject({
      origin: 'manual',
      rule_id: null,
      moved_from: null,
    });
    expect(countEdits(present(state) ?? emptyDiff())).toEqual({
      moved: 1,
      added: 1,
      removed: 1,
      species: 1,
      total: 4,
    });
  });

  test('добавленную перемещают и удаляют как свою: без следа в moved и removed', () => {
    const state = run(
      actions.added({
        projectId: P,
        id: 'manual-1',
        point: [9, 9],
        plantType: 'tree',
        speciesId: null,
      }),
      actions.moved({ projectId: P, id: 'manual-1', point: [8, 8] }),
      actions.speciesChanged({ projectId: P, id: 'manual-1', speciesId: 'betula_pendula' }),
    );
    expect(present(state)?.added['manual-1']).toEqual({
      point: [8, 8],
      plantType: 'tree',
      speciesId: 'betula_pendula',
    });

    const removed = reduce(state, actions.removed({ projectId: P, id: 'manual-1' }));
    expect(present(removed)).toEqual(emptyDiff());
  });

  test('удаление перемещённой снимает и перемещение; «Вернуть на место» — только перемещение', () => {
    const moved = run(
      actions.moved({ projectId: P, id: 'T-1', point: [1, 2] }),
      actions.speciesChanged({ projectId: P, id: 'T-1', speciesId: null }),
    );

    expect(present(reduce(moved, actions.restored({ projectId: P, id: 'T-1' })))).toEqual({
      ...emptyDiff(),
      species: { 'T-1': null },
    });
    expect(present(reduce(moved, actions.removed({ projectId: P, id: 'T-1' })))).toEqual({
      ...emptyDiff(),
      removed: { 'T-1': true },
    });
  });

  test('отмена и повтор; новая правка после отмены стирает будущее', () => {
    let state = run(
      actions.moved({ projectId: P, id: 'T-1', point: [1, 1] }),
      actions.moved({ projectId: P, id: 'T-1', point: [2, 2] }),
      actions.undone({ projectId: P }),
    );
    expect(present(state)?.moved['T-1']).toEqual([1, 1]);

    state = reduce(state, actions.redone({ projectId: P }));
    expect(present(state)?.moved['T-1']).toEqual([2, 2]);

    state = reduce(state, actions.undone({ projectId: P }));
    state = reduce(state, actions.removed({ projectId: P, id: 'S-1' }));
    state = reduce(state, actions.redone({ projectId: P }));
    expect(present(state)?.moved['T-1']).toEqual([1, 1]);
    expect(state[P]?.future).toEqual([]);

    // До начала — пустая разница, дальше отмена ничего не делает.
    for (let step = 0; step < 5; step += 1) state = reduce(state, actions.undone({ projectId: P }));
    expect(present(state)).toEqual(emptyDiff());
  });

  test(`история — не глубже ${String(HISTORY_DEPTH)} правок`, () => {
    let state: PlantingEditsState = {};
    for (let step = 0; step < HISTORY_DEPTH + 20; step += 1) {
      state = reduce(state, actions.moved({ projectId: P, id: 'T-1', point: [step, 0] }));
    }
    expect(state[P]?.past).toHaveLength(HISTORY_DEPTH);

    for (let step = 0; step < HISTORY_DEPTH + 20; step += 1) {
      state = reduce(state, actions.undone({ projectId: P }));
    }
    // Самые старые снимки вытеснены: дальше 100 шагов назад не уйти.
    expect(present(state)?.moved['T-1']).toEqual([19, 0]);
  });

  test('серия нажатий стрелок — одна запись в истории', () => {
    let state: PlantingEditsState = {};
    for (let step = 1; step <= 5; step += 1) {
      state = reduce(
        state,
        actions.moved({ projectId: P, id: 'T-1', point: [step / 10, 0], series: 'a' }),
      );
    }
    state = reduce(state, actions.moved({ projectId: P, id: 'T-1', point: [2, 0], series: 'b' }));

    expect(state[P]?.past).toHaveLength(2);
    state = reduce(state, actions.undone({ projectId: P }));
    expect(present(state)?.moved['T-1']).toEqual([0.5, 0]);
  });

  test('«Сбросить к расстановке сервиса» — тоже правка: её можно отменить', () => {
    let state = run(
      actions.moved({ projectId: P, id: 'T-1', point: [1, 1] }),
      actions.reset({ projectId: P }),
    );
    expect(present(state)).toEqual(emptyDiff());

    state = reduce(state, actions.undone({ projectId: P }));
    expect(present(state)?.moved['T-1']).toEqual([1, 1]);
  });

  test('черновик прошлой обработки — только просмотр: правки и режим правки не действуют', () => {
    const diff = { ...emptyDiff(), removed: { 'S-1': true as const } };
    let state = reduce(
      {},
      actions.opened({ projectId: P, diff, readOnly: true, storage: 'draft' }),
    );
    state = reduce(state, actions.moved({ projectId: P, id: 'T-1', point: [1, 1] }));
    state = reduce(state, actions.editingChanged({ projectId: P, editing: true }));

    expect(present(state)).toEqual(diff);
    expect(state[P]?.editing).toBe(false);
  });

  test('итоговая расстановка — селектор: те же данные — тот же объект', () => {
    const state = { plantingEdits: run(actions.moved({ projectId: P, id: 'T-1', point: [1, 1] })) };

    const first = selectFinalPlanting(state, P, source);

    expect(selectFinalPlanting(state, P, source)).toBe(first);
    expect(first.features[0]?.geometry.coordinates).toEqual([1, 1]);
    // Без правок — исходная расстановка с происхождением «сервис».
    expect(
      selectFinalPlanting({ plantingEdits: {} }, 'other', source).features.map(
        ({ properties }) => properties.origin,
      ),
    ).toEqual(['auto', 'auto']);
  });

  test('идентификатор добавленной — manual-UUID v4', () => {
    expect(manualId()).toMatch(
      /^manual-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(manualId()).not.toBe(manualId());
  });
});

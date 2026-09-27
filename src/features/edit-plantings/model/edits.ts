import {
  createSelector,
  createSlice,
  current,
  isDraft,
  type PayloadAction,
} from '@reduxjs/toolkit';

import type { PlantingFeatureCollection, PlantType } from '@/entities/project';

// Точка в координатах /planting: WGS84 lon/lat или метры чертежа.
export type Point = [number, number];

// Правки — разница с расстановкой сервиса, а не список операций: итог, сохранение, черновик
// и счётчики строятся по ней напрямую, а «переместить и удалить» не оставляет следа.
export type PlantingDiff = {
  moved: Record<string, Point>;
  added: Record<string, { point: Point; plantType: PlantType; speciesId: string | null }>;
  removed: Record<string, true>;
  species: Record<string, string | null>;
};

export type EditTool = 'select' | 'tree' | 'shrub';

// Где живут правки: на сервере (plantingEdits), черновиком в браузере или только в памяти —
// если хранилище браузера недоступно.
export type EditsStorage = 'server' | 'draft' | 'memory';

type ProjectEdits = {
  present: PlantingDiff;
  past: PlantingDiff[];
  future: PlantingDiff[];
  // Серия нажатий стрелок — одна запись в истории; её ключ задаёт вызывающий.
  series: string | null;
  // Что уже сохранено (на сервере или в черновике): несохранённые правки — разница с ним.
  saved: PlantingDiff;
  editing: boolean;
  tool: EditTool;
  // Черновик прошлой обработки, оставленный для просмотра: править нельзя.
  readOnly: boolean;
  storage: EditsStorage;
  // Найден черновик прошлой обработки: пока пользователь не решил, что с ним делать, правок нет.
  stale: PlantingDiff | null;
};

export type PlantingEditsState = Record<string, ProjectEdits>;

export const HISTORY_DEPTH = 100;

export const emptyDiff = (): PlantingDiff => ({ moved: {}, added: {}, removed: {}, species: {} });

const fresh = (
  diff: PlantingDiff,
  {
    readOnly = false,
    storage = 'server',
    stale = null,
  }: Partial<Pick<ProjectEdits, 'readOnly' | 'storage' | 'stale'>> = {},
): ProjectEdits => ({
  present: diff,
  past: [],
  future: [],
  series: null,
  saved: diff,
  editing: false,
  tool: 'select',
  readOnly,
  storage,
  stale,
});

type Of<T = object> = PayloadAction<{ projectId: string } & T>;

const entryOf = (state: PlantingEditsState, projectId: string): ProjectEdits => {
  state[projectId] ??= fresh(emptyDiff());
  return state[projectId];
};

// Снимок разницы для истории. У только что созданной записи разница — обычный объект, а не
// черновик immer: без копии правка изменила бы и снимок.
const snapshot = (diff: PlantingDiff): PlantingDiff =>
  isDraft(diff) ? current(diff) : structuredClone(diff);

// Правка: снимок в историю (не глубже HISTORY_DEPTH), будущее — прочь. Нажатия одной серии
// идут в одну запись.
function record(entry: ProjectEdits, series: string | null, change: (diff: PlantingDiff) => void) {
  if (entry.readOnly) return;
  if (series === null || series !== entry.series) {
    entry.past.push(snapshot(entry.present));
    if (entry.past.length > HISTORY_DEPTH) entry.past.shift();
  }
  entry.series = series;
  entry.future = [];
  change(entry.present);
}

const initialState: PlantingEditsState = {};

export const plantingEditsSlice = createSlice({
  name: 'plantingEdits',
  initialState,
  reducers: {
    // Правки загружены (с сервера или из черновика): история начинается заново.
    opened: (
      state,
      { payload }: Of<{ diff: PlantingDiff; readOnly?: boolean; storage: EditsStorage }>,
    ) => {
      state[payload.projectId] = fresh(payload.diff, {
        readOnly: payload.readOnly ?? false,
        storage: payload.storage,
      });
    },
    // Черновик прошлой обработки: правок нет, пока не выбрано «Удалить» или «Оставить как есть».
    staleFound: (state, { payload }: Of<{ diff: PlantingDiff }>) => {
      state[payload.projectId] = fresh(emptyDiff(), {
        readOnly: true,
        storage: 'draft',
        stale: payload.diff,
      });
    },
    // Черновик не записался: правки живут до перезагрузки страницы.
    storageLost: (state, { payload }: Of) => {
      entryOf(state, payload.projectId).storage = 'memory';
    },
    editingChanged: (state, { payload }: Of<{ editing: boolean }>) => {
      const entry = entryOf(state, payload.projectId);
      entry.editing = payload.editing && !entry.readOnly;
      entry.tool = 'select';
    },
    toolChanged: (state, { payload }: Of<{ tool: EditTool }>) => {
      entryOf(state, payload.projectId).tool = payload.tool;
    },
    moved: (state, { payload }: Of<{ id: string; point: Point; series?: string }>) => {
      record(entryOf(state, payload.projectId), payload.series ?? null, (diff) => {
        const added = diff.added[payload.id];
        if (added === undefined) diff.moved[payload.id] = payload.point;
        else added.point = payload.point;
      });
    },
    restored: (state, { payload }: Of<{ id: string }>) => {
      record(entryOf(state, payload.projectId), null, (diff) => {
        Reflect.deleteProperty(diff.moved, payload.id);
      });
    },
    added: (
      state,
      { payload }: Of<{ id: string; point: Point; plantType: PlantType; speciesId: string | null }>,
    ) => {
      record(entryOf(state, payload.projectId), null, (diff) => {
        diff.added[payload.id] = {
          point: payload.point,
          plantType: payload.plantType,
          speciesId: payload.speciesId,
        };
      });
    },
    removed: (state, { payload }: Of<{ id: string }>) => {
      record(entryOf(state, payload.projectId), null, (diff) => {
        if (payload.id in diff.added) {
          Reflect.deleteProperty(diff.added, payload.id);
          return;
        }
        diff.removed[payload.id] = true;
        Reflect.deleteProperty(diff.moved, payload.id);
        Reflect.deleteProperty(diff.species, payload.id);
      });
    },
    speciesChanged: (state, { payload }: Of<{ id: string; speciesId: string | null }>) => {
      record(entryOf(state, payload.projectId), null, (diff) => {
        const added = diff.added[payload.id];
        if (added === undefined) diff.species[payload.id] = payload.speciesId;
        else added.speciesId = payload.speciesId;
      });
    },
    reset: (state, { payload }: Of) => {
      record(entryOf(state, payload.projectId), null, (diff) => {
        Object.assign(diff, emptyDiff());
      });
    },
    undone: (state, { payload }: Of) => {
      const entry = entryOf(state, payload.projectId);
      const previous = entry.past.pop();
      if (previous === undefined || entry.readOnly) return;
      entry.future.push(snapshot(entry.present));
      entry.present = previous;
      entry.series = null;
    },
    redone: (state, { payload }: Of) => {
      const entry = entryOf(state, payload.projectId);
      const next = entry.future.pop();
      if (next === undefined || entry.readOnly) return;
      entry.past.push(snapshot(entry.present));
      entry.present = next;
      entry.series = null;
    },
    saved: (state, { payload }: Of<{ diff: PlantingDiff }>) => {
      entryOf(state, payload.projectId).saved = payload.diff;
    },
  },
});

export const plantingEditsActions = plantingEditsSlice.actions;

type WithEdits = { plantingEdits: PlantingEditsState };

export const selectProjectEdits = (state: WithEdits, projectId: string): ProjectEdits | undefined =>
  state.plantingEdits[projectId];

// На сервере не то, что на экране. Сравнение по содержимому: отмена и повтор кладут в present
// копию, и «сохранить, отменить, повторить» не должно давать несохранённых правок. Разница мала.
export const isUnsaved = ({ storage, present, saved }: ProjectEdits): boolean =>
  storage === 'server' && present !== saved && JSON.stringify(present) !== JSON.stringify(saved);

// Итоговая посадка: исходная из /planting с правками. Происхождение, исходная точка
// перемещённой и смена породы — в свойствах: по ним карта, ведомость и экспорт показывают правку.
export type FinalPlantingProperties =
  PlantingFeatureCollection['features'][number]['properties'] & {
    origin: 'auto' | 'manual';
    moved_from: readonly number[] | null;
    species_changed: boolean;
  };

export type FinalPlanting = Omit<PlantingFeatureCollection, 'features'> & {
  features: {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: number[] };
    properties: FinalPlantingProperties;
  }[];
};

// Правило у добавленной вручную: у бэкенда такого нет, имя правила не показывается.
export const MANUAL_RULE = 'manual';

export function applyDiff(source: PlantingFeatureCollection, diff: PlantingDiff): FinalPlanting {
  const features: FinalPlanting['features'] = source.features.flatMap((feature) => {
    const { id } = feature.properties;
    if (diff.removed[id] === true) return [];
    const moved = diff.moved[id];
    const species = id in diff.species ? diff.species[id] : feature.properties.species_id;
    return [
      {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: moved ?? [...feature.geometry.coordinates],
        },
        properties: {
          ...feature.properties,
          species_id: species ?? null,
          // Порода сменена — причина выбора сервиса к ней больше не относится.
          species_reason_ru:
            id in diff.species ? null : (feature.properties.species_reason_ru ?? null),
          origin: 'auto' as const,
          moved_from: moved === undefined ? null : feature.geometry.coordinates,
          species_changed: id in diff.species,
        },
      },
    ];
  });
  for (const [id, { point, plantType, speciesId }] of Object.entries(diff.added)) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: point },
      properties: {
        id,
        plant_type: plantType,
        rule_id: MANUAL_RULE,
        species_id: speciesId,
        species_reason_ru: null,
        origin: 'manual',
        moved_from: null,
        species_changed: false,
      },
    });
  }
  return { ...source, features };
}

// Итоговая расстановка — одна на проект и исходные данные: карта, ведомость и экспорт
// берут её отсюда, а не из /planting.
export const selectFinalPlanting = createSelector(
  [
    (state: WithEdits, projectId: string) => state.plantingEdits[projectId]?.present,
    (_state: WithEdits, _projectId: string, source: PlantingFeatureCollection) => source,
  ],
  (diff, source) => applyDiff(source, diff ?? emptyDiff()),
);

export type EditCounts = {
  moved: number;
  added: number;
  removed: number;
  species: number;
  total: number;
};

export function countEdits(diff: PlantingDiff): EditCounts {
  const moved = Object.keys(diff.moved).length;
  const added = Object.keys(diff.added).length;
  const removed = Object.keys(diff.removed).length;
  const species = Object.keys(diff.species).length;
  return { moved, added, removed, species, total: moved + added + removed + species };
}

// Идентификатор добавленной посадки. crypto.randomUUID есть только в защищённом контексте,
// а контур заказчика может открываться по http: UUID v4 — из getRandomValues.
export function manualId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `manual-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

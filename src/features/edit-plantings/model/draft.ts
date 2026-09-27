import { z } from 'zod';

import type { PlantingDiff } from './edits';

// Без возможности plantingEdits правки живут черновиком в браузере. Ключ — проект, в черновике —
// finished_at обработки: переобработка делает черновик устаревшим, его координаты относятся
// к прошлой расстановке.
const keyOf = (projectId: string) => `greenleaders:planting-edits:${projectId}`;

const point = z.tuple([z.number(), z.number()]);
// Хранилище — внешние данные: черновик проверяется, прежде чем стать правками.
const draftSchema = z.object({
  finishedAt: z.string().nullable(),
  diff: z.object({
    moved: z.record(z.string(), point),
    added: z.record(
      z.string(),
      z.object({
        point,
        plantType: z.enum(['tree', 'shrub']),
        speciesId: z.string().nullable(),
      }),
    ),
    removed: z.record(z.string(), z.literal(true)),
    species: z.record(z.string(), z.string().nullable()),
  }),
});

export type DraftRead =
  | { kind: 'none' }
  | { kind: 'current'; diff: PlantingDiff }
  | { kind: 'stale'; diff: PlantingDiff }
  // Хранилище недоступно (приватный режим, запрет сайта): правки живут до перезагрузки.
  | { kind: 'unavailable' };

// Доступ к localStorage в браузере бросает, если сайту запрещено хранить данные.
// eslint-disable-next-line no-restricted-properties -- черновик правок, не токены: security.md запрещает хранить только их
const storage = (): Storage => window.localStorage;

export function readDraft(projectId: string, finishedAt: string | null): DraftRead {
  let raw: string | null;
  try {
    raw = storage().getItem(keyOf(projectId));
  } catch {
    return { kind: 'unavailable' };
  }
  if (raw === null) return { kind: 'none' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'none' };
  }
  const draft = draftSchema.safeParse(parsed);
  if (!draft.success) return { kind: 'none' };
  return draft.data.finishedAt === finishedAt
    ? { kind: 'current', diff: draft.data.diff }
    : { kind: 'stale', diff: draft.data.diff };
}

// false — записать не удалось: правки остаются только в памяти.
export function writeDraft(
  projectId: string,
  finishedAt: string | null,
  diff: PlantingDiff,
): boolean {
  try {
    storage().setItem(keyOf(projectId), JSON.stringify({ finishedAt, diff }));
    return true;
  } catch {
    return false;
  }
}

export function removeDraft(projectId: string): void {
  try {
    storage().removeItem(keyOf(projectId));
  } catch {
    // Хранилище недоступно — и черновика в нём нет.
  }
}

import { z } from 'zod';

import type { ManualGeoreference } from '@/entities/project';

// Без возможности manualGeoreference привязка из модуля живёт в браузере. Ключ — проект, в записи —
// finished_at обработки: переобработка могла сменить чертёж, и привязка к нему уже не относится.
const keyOf = (projectId: string) => `greenleaders:georeference:${projectId}`;

const latLon = z.object({ lat: z.number(), lon: z.number() });
const xy = z.object({ x: z.number(), y: z.number() });
// Хранилище — внешние данные: запись проверяется, прежде чем стать привязкой.
const storedSchema = z.object({
  finishedAt: z.string().nullable(),
  georeference: z.object({
    anchor_wgs84: latLon,
    anchor_drawing: xy,
    rotation_deg: z.number(),
    scale: z.number().positive(),
    method: z.enum(['manual', 'control_points']),
    rms_m: z.number().nullable(),
    control_points: z.array(
      z.object({
        label: z.string().nullable().optional(),
        drawing: xy,
        wgs84: latLon,
        residual_m: z.number(),
        used: z.boolean(),
      }),
    ),
  }),
});

export type StoredGeoreference =
  | { kind: 'none' }
  | { kind: 'current'; georeference: ManualGeoreference }
  // Проект обработан заново после привязки.
  | { kind: 'stale'; georeference: ManualGeoreference };

// Доступ к localStorage в браузере бросает, если сайту запрещено хранить данные.
// eslint-disable-next-line no-restricted-properties -- привязка чертежа, не токены: security.md запрещает хранить только их
const storage = (): Storage => window.localStorage;

const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

// Подписка для useSyncExternalStore: своя запись и запись из другой вкладки.
export function subscribeStored(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

// Сырая строка: у неё есть равенство, и React не перерисовывает экран, пока запись та же.
// Хранилище недоступно — как будто привязки нет.
export function readStoredRaw(projectId: string): string | null {
  try {
    return storage().getItem(keyOf(projectId));
  } catch {
    return null;
  }
}

export function parseStored(raw: string | null, finishedAt: string | null): StoredGeoreference {
  if (raw === null) return { kind: 'none' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'none' };
  }
  const stored = storedSchema.safeParse(parsed);
  if (!stored.success) return { kind: 'none' };
  const { georeference } = stored.data;
  return stored.data.finishedAt === finishedAt
    ? { kind: 'current', georeference }
    : { kind: 'stale', georeference };
}

// false — записать не удалось: браузер не даёт хранить данные сайта.
export function writeStored(
  projectId: string,
  finishedAt: string | null,
  georeference: ManualGeoreference,
): boolean {
  try {
    storage().setItem(keyOf(projectId), JSON.stringify({ finishedAt, georeference }));
  } catch {
    return false;
  }
  notify();
  return true;
}

export function removeStored(projectId: string): void {
  try {
    storage().removeItem(keyOf(projectId));
  } catch {
    // Хранилище недоступно — и привязки в нём нет.
  }
  notify();
}

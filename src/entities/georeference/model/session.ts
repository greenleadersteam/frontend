import type { Contour, Reference } from '@/shared/lib/contour';
import type { LatLon } from '@/shared/lib/geodesy';
import { enuToGeodetic, vincentyInverse } from '@/shared/lib/geodesy';
import type { GcpPair, Placement, SnapKind, WorkScale } from '@/shared/lib/georeference';
import { normalizeAngle, sizeOnMap, solve } from '@/shared/lib/georeference';

// Состояние ручной привязки и история отмены. Перенесено из прототипа ../geojson/js/store.js
// (история, опорные точки, эталоны), ../geojson/js/transform.js (дискретные действия)
// и ../geojson/js/gcp.js (передача управления точкам) без изменений логики. В прототипе это
// изменяемый объект с шиной событий; здесь — неизменяемое значение и чистые функции, чтобы
// состояние можно было держать в store приложения.

const LIMIT = 100; // глубина истории

// Ручное положение, отброшенное опорными точками.
export type Handoff = {
  anchor: LatLon;
  rotation: number;
  scale: number;
  count: number;
  shift: number;
  rotationChange: number;
  // Смещение больше габарита — скорее всего точки пары не соответствуют друг другу.
  big: boolean;
};

// То, что откатывает отмена.
type Snapshot = {
  source: Contour | null;
  anchor: LatLon | null;
  rotation: number;
  scale: number;
  gcp: readonly GcpPair[];
  // Передача управления точкам откатывается вместе с ними: отмена после второй пары возвращает
  // ручное совмещение целиком.
  handoff: Handoff | null;
  // Пользователь сам выбирал единицы файла.
  unitsConfirmed: boolean;
};

// Видимость эталона на карте — его собственное поле, как в прототипе: скрытый эталон остаётся
// в списке и в сравнении.
// Номер добавления seq не меняется при удалении соседей: по нему эталон держит свой оттенок
// на карте и в списке.
export type StoredReference = Reference & { id: string; seq: number; visible: boolean };

export type Session = Snapshot & {
  // Знаменатель масштаба работ для допуска.
  workScale: WorkScale;
  // Эталоны живут вне истории отмены: это не привязка, а отпечатки для сравнения, и откатывать их
  // вместе со сдвигом было бы неожиданно.
  references: readonly StoredReference[];
  undoStack: readonly Snapshot[];
  redoStack: readonly Snapshot[];
  gcpSeq: number;
  referenceSeq: number;
};

export const createSession = (): Session => ({
  source: null,
  anchor: null,
  rotation: 0,
  scale: 1,
  gcp: [],
  handoff: null,
  unitsConfirmed: false,
  workScale: 500,
  references: [],
  undoStack: [],
  redoStack: [],
  gcpSeq: 0,
  referenceSeq: 0,
});

export function placementOf(session: Session): Placement | null {
  const { source, anchor, rotation, scale } = session;
  return source === null || anchor === null ? null : { source, anchor, rotation, scale };
}

// Массив точек не копируется: точки неизменяемы, правка создаёт новый объект, поэтому снимок
// не «уезжает» вместе с состоянием.
const snapshotOf = (s: Session): Snapshot => ({
  source: s.source,
  anchor: s.anchor,
  rotation: s.rotation,
  scale: s.scale,
  gcp: s.gcp,
  handoff: s.handoff,
  unitsConfirmed: s.unitsConfirmed,
});

// Снимок берётся ПЕРЕД дискретным действием: началом перетаскивания, началом вращения, правкой
// поля, шагом стрелкой. Непрерывное движение мыши снимков не берёт — где начинается действие,
// знает вызывающая сторона.
export const snapshot = (s: Session): Session => ({
  ...s,
  undoStack: [...s.undoStack, snapshotOf(s)].slice(-LIMIT),
  redoStack: [],
});

export type SessionPatch = Partial<
  Pick<
    Session,
    'anchor' | 'rotation' | 'scale' | 'gcp' | 'handoff' | 'unitsConfirmed' | 'workScale'
  >
>;

export const updateSession = (s: Session, patch: SessionPatch): Session => ({ ...s, ...patch });

export function undo(s: Session): Session {
  const previous = s.undoStack.at(-1);
  if (previous === undefined) return s;
  return {
    ...s,
    ...previous,
    undoStack: s.undoStack.slice(0, -1),
    redoStack: [...s.redoStack, snapshotOf(s)],
  };
}

export function redo(s: Session): Session {
  const next = s.redoStack.at(-1);
  if (next === undefined) return s;
  return {
    ...s,
    ...next,
    redoStack: s.redoStack.slice(0, -1),
    undoStack: [...s.undoStack, snapshotOf(s)],
  };
}

export function loadContour(s: Session, source: Contour, anchor: LatLon): Session {
  return {
    ...snapshot(s),
    source,
    anchor: { lat: anchor.lat, lon: anchor.lon },
    rotation: 0,
    scale: 1,
    // Опорные точки заданы в координатах прежнего файла — к новому контуру они не относятся.
    gcp: [],
    handoff: null,
    unitsConfirmed: false,
  };
}

export const clearContour = (s: Session): Session => ({
  ...snapshot(s),
  source: null,
  anchor: null,
  rotation: 0,
  scale: 1,
});

// Снимок в историю берёт вызывающая сторона.

export function moveBy(s: Session, dEast: number, dNorth: number): Session {
  if (s.anchor === null) return s;
  const g = enuToGeodetic({ e: dEast, n: dNorth, u: 0 }, s.anchor);
  return updateSession(s, { anchor: { lat: g.lat, lon: g.lon } });
}

export const setAnchor = (s: Session, anchor: LatLon): Session =>
  updateSession(s, { anchor: { lat: anchor.lat, lon: anchor.lon } });

export const rotateBy = (s: Session, degrees: number): Session =>
  updateSession(s, { rotation: normalizeAngle(s.rotation + degrees) });

export const setRotation = (s: Session, degrees: number): Session =>
  updateSession(s, { rotation: normalizeAngle(degrees) });

// Поле в панели — «метров в единице файла»: ровно тот множитель, который возвращает подгонка
// подобия и который показан в диагностике. Никакого 1/x: иначе пользователь видел бы 0,001,
// а вводил 1000. Недопустимое значение состояние не меняет.
export const setScale = (s: Session, metersPerUnit: number): Session =>
  Number.isFinite(metersPerUnit) && metersPerUnit > 0
    ? updateSession(s, { scale: metersPerUnit })
    : s;

export type NewGcpPair = { x: number; y: number; lat: number; lon: number; kind?: SnapKind };

export function addGcp(s: Session, pair: NewGcpPair): Session {
  const gcpSeq = s.gcpSeq + 1;
  const item: GcpPair = {
    id: `gcp-${String(gcpSeq)}`,
    n: s.gcp.reduce((m, p) => Math.max(m, p.n), 0) + 1,
    x: pair.x,
    y: pair.y,
    lat: pair.lat,
    lon: pair.lon,
    kind: pair.kind ?? 'vertex',
    enabled: true,
    control: false,
  };
  return { ...s, gcp: [...s.gcp, item], gcpSeq };
}

export type GcpPatch = Partial<Omit<GcpPair, 'id' | 'n'>>;

// Правка точки заменяет её копией: иначе снимок истории менялся бы вместе с состоянием и отмена
// ничего не возвращала бы.
export const updateGcp = (s: Session, id: string, patch: GcpPatch): Session => ({
  ...s,
  gcp: s.gcp.map((p) => (p.id === id ? { ...p, ...patch } : p)),
});

export const removeGcp = (s: Session, id: string): Session => ({
  ...s,
  gcp: s.gcp.filter((p) => p.id !== id),
});

export const clearGcp = (s: Session): Session => ({ ...s, gcp: [] });

// Пересчитать контур по точкам. Вызывается после каждой правки набора.
//
// Решение по двум парам проходит ровно через два клика и полностью отбрасывает ручное совмещение —
// это верно, но выглядит как поломка. Поэтому в момент, когда точки забирают управление, ручное
// положение запоминается: панель объясняет скачок и умеет вернуть как было.
export function applyGcp(s: Session): Session {
  const solution = s.source === null ? null : solve(s.source, s.gcp);

  if (solution === null) {
    return s.handoff === null ? s : updateSession(s, { handoff: null });
  }

  const patch: SessionPatch = {
    anchor: solution.anchor,
    rotation: solution.rotation,
    scale: solution.scale,
  };

  if (s.handoff === null && s.anchor !== null && s.source !== null) {
    const shift = vincentyInverse(s.anchor, solution.anchor).distance;
    const size = sizeOnMap({ source: s.source, scale: s.scale });
    patch.handoff = {
      anchor: { lat: s.anchor.lat, lon: s.anchor.lon },
      rotation: s.rotation,
      scale: s.scale,
      count: solution.count,
      shift,
      rotationChange: normalizeAngle(solution.rotation - s.rotation),
      big: shift > Math.max(size.width, size.height),
    };
  }

  return updateSession(s, patch);
}

// Вернуть ручное совмещение: прежнее положение и выключенные точки. Точки не удаляются — их
// невязки показывают, насколько ручное положение расходится с ними, и их можно включить обратно.
export function restoreManual(s: Session): Session {
  const h = s.handoff;
  if (h === null) return s;
  return updateSession(snapshot(s), {
    gcp: s.gcp.map((p) => (!p.enabled || p.control ? p : { ...p, enabled: false })),
    anchor: { lat: h.anchor.lat, lon: h.anchor.lon },
    rotation: h.rotation,
    scale: h.scale,
    handoff: null,
  });
}

export function addReference(s: Session, reference: Reference): Session {
  const referenceSeq = s.referenceSeq + 1;
  const stored: StoredReference = {
    ...reference,
    id: `ref-${String(referenceSeq)}`,
    seq: referenceSeq,
    visible: true,
  };
  return { ...s, references: [...s.references, stored], referenceSeq };
}

export const removeReference = (s: Session, id: string): Session => ({
  ...s,
  references: s.references.filter((r) => r.id !== id),
});

export const clearReferences = (s: Session): Session => ({ ...s, references: [] });

export const setReferenceVisible = (s: Session, id: string, visible: boolean): Session => ({
  ...s,
  references: s.references.map((r) => (r.id === id ? { ...r, visible } : r)),
});

// Совпадает ли эталон с уже загруженным: опорная точка, поворот и масштаб. Выгрузка одной
// привязки даёт JSON и geojson, которые в списке выглядят одинаково — дубль ловится по числам.
export function findSameReference(s: Session, reference: Reference): StoredReference | null {
  for (const r of s.references) {
    const distance = vincentyInverse(r.anchor, reference.anchor).distance;
    const sameScale =
      r.scale && reference.scale
        ? Math.abs(reference.scale / r.scale - 1) < 1e-9
        : r.scale === reference.scale;
    if (distance < 1e-3 && Math.abs(r.rotation - reference.rotation) < 1e-6 && sameScale) {
      return r;
    }
  }
  return null;
}

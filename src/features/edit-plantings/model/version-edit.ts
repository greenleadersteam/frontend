import type {
  PlantingEdit,
  PlantingFeatureCollection,
  PlantingVersionFeatureCollection,
  PlantType,
} from '@/entities/project';

import { emptyDiff, type PlantingDiff, type Point } from './edits';

const samePoint = (a: readonly number[], b: readonly number[]) => a[0] === b[0] && a[1] === b[1];

// Версия как разница с версией сервиса: id посадок сервиса во всех версиях те же
// (contracts/openapi.proposed.yaml, /plantings/{version}). Породу правка версии не меняет,
// поэтому её разницы нет.
export function diffFromVersion(
  service: PlantingFeatureCollection,
  version: PlantingVersionFeatureCollection,
): PlantingDiff {
  const diff = emptyDiff();
  const byId = new Map(version.features.map((feature) => [feature.properties.id, feature]));
  for (const { geometry, properties } of service.features) {
    const edited = byId.get(properties.id);
    if (edited === undefined) {
      diff.removed[properties.id] = true;
      continue;
    }
    const [x = 0, y = 0] = edited.geometry.coordinates;
    if (!samePoint(edited.geometry.coordinates, geometry.coordinates)) {
      diff.moved[properties.id] = [x, y];
    }
    byId.delete(properties.id);
  }
  for (const [id, { geometry, properties }] of byId) {
    const [x = 0, y = 0] = geometry.coordinates;
    diff.added[id] = {
      point: [x, y] satisfies Point,
      plantType: properties.plant_type,
      speciesId: properties.species_id ?? null,
    };
  }
  return diff;
}

type Placed = Map<string, { point: readonly number[]; plantType: PlantType }>;

function placed(service: PlantingFeatureCollection, diff: PlantingDiff): Placed {
  const result: Placed = new Map();
  for (const { geometry, properties } of service.features) {
    if (diff.removed[properties.id] === true) continue;
    result.set(properties.id, {
      point: diff.moved[properties.id] ?? geometry.coordinates,
      plantType: properties.plant_type,
    });
  }
  for (const [id, { point, plantType }] of Object.entries(diff.added)) {
    result.set(id, { point, plantType });
  }
  return result;
}

// Правка сохранённой версии до того, что на экране. Посадка сервиса, удалённая в сохранённой
// версии и возвращённая на экране, идёт в update: так сервер возвращает её со своим id.
// Смена породы не отправляется — в API версий её нет. toDrawing — точка плана в метрах
// чертежа: по ней сервер пишет посадку в DXF версии.
export function versionEdit(
  service: PlantingFeatureCollection,
  saved: PlantingDiff,
  present: PlantingDiff,
  name: string,
  toDrawing: (point: readonly number[]) => [number, number],
): PlantingEdit {
  const before = placed(service, saved);
  const after = placed(service, present);
  const serviceIds = new Set(service.features.map(({ properties }) => properties.id));
  const edit: PlantingEdit = {
    name: name.trim() === '' ? null : name.trim(),
    add: [],
    update: [],
    delete: [...before.keys()].filter((id) => !after.has(id)),
  };
  for (const [id, { point, plantType }] of after) {
    const previous = before.get(id);
    if (previous !== undefined && samePoint(previous.point, point)) continue;
    const [lon = 0, lat = 0] = point;
    const [x, y] = toDrawing(point);
    if (previous === undefined && !serviceIds.has(id)) {
      edit.add.push({ client_id: id, lon, lat, x, y, plant_type: plantType });
    } else {
      edit.update.push({ id, lon, lat, x, y });
    }
  }
  return edit;
}

// Правка, после которой версия не изменится: такую сервер не принимает (422).
export const isEmptyEdit = ({ add, update, delete: removed }: PlantingEdit): boolean =>
  add.length === 0 && update.length === 0 && removed.length === 0;

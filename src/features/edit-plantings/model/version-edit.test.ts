import { describe, expect, test } from 'vitest';

import type {
  PlantingFeatureCollection,
  PlantingVersionFeatureCollection,
} from '@/entities/project';

import { emptyDiff, type PlantingDiff } from './edits';
import { diffFromVersion, isEmptyEdit, versionEdit } from './version-edit';

const service: PlantingFeatureCollection = {
  type: 'FeatureCollection',
  metadata: { crs: 'local' },
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { id: 'T-1', plant_type: 'tree', rule_id: 'R' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [5, 0] },
      properties: { id: 'T-2', plant_type: 'tree', rule_id: 'R' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [10, 0] },
      properties: { id: 'T-3', plant_type: 'tree', rule_id: 'R' },
    },
  ],
};

const diff = (patch: Partial<PlantingDiff>): PlantingDiff => ({ ...emptyDiff(), ...patch });

describe('versionEdit', () => {
  test('от версии сервиса: удаление, перемещение и добавление — delete, update, add', () => {
    const present = diff({
      removed: { 'T-1': true },
      moved: { 'T-2': [5, 1] },
      added: { 'draft-1': { point: [7, 7], plantType: 'shrub', speciesId: 'rosa' } },
      species: { 'T-3': 'acer' },
    });

    expect(versionEdit(service, emptyDiff(), present, '  Вариант ')).toEqual({
      name: 'Вариант',
      delete: ['T-1'],
      update: [{ id: 'T-2', lon: 5, lat: 1 }],
      add: [{ client_id: 'draft-1', lon: 7, lat: 7, plant_type: 'shrub' }],
    });
  });

  test('от сохранённой версии: только разница с ней; добавленная раньше — по своему id', () => {
    const saved = diff({
      removed: { 'T-1': true },
      added: { 'MANUAL-00001': { point: [7, 7], plantType: 'tree', speciesId: null } },
    });
    const present = diff({
      removed: { 'T-1': true, 'T-3': true },
      added: { 'MANUAL-00001': { point: [8, 7], plantType: 'tree', speciesId: null } },
    });

    expect(versionEdit(service, saved, present, '')).toEqual({
      name: null,
      delete: ['T-3'],
      update: [{ id: 'MANUAL-00001', lon: 8, lat: 7 }],
      add: [],
    });
  });

  test('посадка сервиса, удалённая в версии, возвращается через update со своим id', () => {
    const saved = diff({ removed: { 'T-2': true } });

    expect(versionEdit(service, saved, emptyDiff(), '')).toMatchObject({
      update: [{ id: 'T-2', lon: 5, lat: 0 }],
      add: [],
    });
  });

  test('возврат на место и смена породы — пустая правка', () => {
    const saved = diff({ moved: { 'T-2': [5, 1] } });
    const present = diff({ moved: { 'T-2': [5, 1] }, species: { 'T-1': 'acer' } });

    expect(isEmptyEdit(versionEdit(service, saved, present, 'имя'))).toBe(true);
  });
});

describe('diffFromVersion', () => {
  test('версия как разница с версией сервиса', () => {
    const version: PlantingVersionFeatureCollection = {
      type: 'FeatureCollection',
      metadata: { crs: 'local', version: 2 },
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [5, 1] },
          properties: { id: 'T-2', plant_type: 'tree', rule_id: 'R', origin: 'manual' },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [10, 0] },
          properties: { id: 'T-3', plant_type: 'tree', rule_id: 'R', origin: 'auto' },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [7, 7] },
          properties: { id: 'MANUAL-00001', plant_type: 'shrub', rule_id: null, origin: 'manual' },
        },
      ],
    };

    expect(diffFromVersion(service, version)).toEqual({
      removed: { 'T-1': true },
      moved: { 'T-2': [5, 1] },
      added: { 'MANUAL-00001': { point: [7, 7], plantType: 'shrub', speciesId: null } },
      species: {},
    });
  });
});

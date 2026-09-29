import { describe, expect, test } from 'vitest';

import type { Norm } from '../api/project-result-api';
import { normBasis, verifiedReference } from './norm-basis';

const regulation = (basis: ReturnType<typeof normBasis>) =>
  basis?.basis === 'regulation' && basis.verified !== null
    ? verifiedReference(basis.verified)
    : null;
const ACT_743_CLAUSE = 'ПП Москвы №\u00A0743-ПП, прил. 1, п. 3.6.3, табл. 3.6.1';

const norm = (basis: Norm['basis'], text: string): Norm => ({
  id: '743-pp-gas-shrub',
  obstacle_category: 'underground_utilities',
  obstacle_subtype: 'gas',
  plant_type: 'shrub',
  distance_m: 1.5,
  basis,
  citation: '743-ПП — газопровод',
  act: 'ПП Москвы от 10.09.2002 № 743-ПП, прил. 1',
  clause: null,
  text,
  source_url: null,
});

describe('normBasis', () => {
  test('без /norms: у кустарника у газопровода нормы в акте нет, у дерева — есть', () => {
    expect(normBasis(null, 'underground_utilities', 'gas', 'shrub', 1.5)).toEqual({
      basis: 'service_default',
      reason: 'Для кустарника у газопровода норма в ПП №\u00A0743-ПП, табл. 3.6.1, не установлена',
    });
    expect(regulation(normBasis(null, 'underground_utilities', 'gas', 'tree', 1.5))).toBe(
      ACT_743_CLAUSE,
    );
  });

  test('неопознанная сеть и существующее дерево — значение сервиса для обоих типов', () => {
    for (const plantType of ['tree', 'shrub'] as const) {
      expect(normBasis(null, 'underground_utilities', 'other_utility', plantType, 2)?.basis).toBe(
        'service_default',
      );
    }
    expect(normBasis(null, 'green_existing', 'existing_tree', 'tree', 6)?.basis).toBe(
      'service_default',
    );
  });

  test('бортовой камень — край проезжей части, норма акта', () => {
    expect(regulation(normBasis(null, 'road_edge', null, 'tree', 2))).toBe(ACT_743_CLAUSE);
    expect(regulation(normBasis(null, 'road_edge', null, 'shrub', 1))).toBe(ACT_743_CLAUSE);
  });

  test('здание — норма акта; у школы и детского сада своя строка', () => {
    expect(regulation(normBasis(null, 'buildings', null, 'tree', 5))).toBe(ACT_743_CLAUSE);
    expect(regulation(normBasis(null, 'buildings', null, 'shrub', 1.5))).toBe(ACT_743_CLAUSE);
    expect(regulation(normBasis(null, 'buildings', 'school_kindergarten', 'tree', 10))).toBe(
      ACT_743_CLAUSE,
    );
  });

  test('край трамвайного полотна — пункт СП 42, а не 743-ПП', () => {
    expect(regulation(normBasis(null, 'tram_tracks', 'bed_edge', 'tree', 5))).toBe(
      'СП 42.13330.2016, п. 9.6, табл. 9.1',
    );
  });

  test('другое значение сервиса таблица не подтверждает: основание неизвестно', () => {
    expect(normBasis(null, 'underground_utilities', 'gas', 'tree', 2)).toBeNull();
    expect(normBasis(null, 'road_edge', null, 'tree', 0.7)).toBeNull();
    expect(normBasis(null, 'buildings', 'school_kindergarten', 'tree', 5)).toBeNull();
  });

  test('с /norms — основание и причина сервера, таблица не нужна', () => {
    expect(normBasis(norm('service_default', 'Причина сервера'), 'x', null, 'shrub', 9)).toEqual({
      basis: 'service_default',
      reason: 'Причина сервера',
    });
    // Пункт даёт сервер (clause), сверка фронтенда не нужна.
    expect(normBasis(norm('regulation', 'Текст'), 'x', null, 'shrub', 9)).toEqual({
      basis: 'regulation',
      verified: null,
    });
  });
});

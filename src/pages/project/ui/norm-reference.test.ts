import { describe, expect, test } from 'vitest';

import { normBasis } from '@/entities/project';

import { basisReference, normReference } from './norm-reference';

const CABLE = '743-ПП, табл. 3.6.1 — силовой кабель';

describe('basisReference без /norms', () => {
  test('норма акта из сверки — полная ссылка с пунктом, помечена как сверка', () => {
    const basis = normBasis(null, 'underground_utilities', 'power_cable', 'tree', 2);

    expect(basisReference(basis, null, CABLE)).toEqual({
      text: 'ПП Москвы №\u00A0743-ПП, прил. 1, п. 3.6.3, табл. 3.6.1',
      verified: true,
    });
  });

  test('значение сервиса и неподтверждённое число — citation сервера без пункта', () => {
    const gasShrub = normBasis(null, 'underground_utilities', 'gas', 'shrub', 1.5);
    const otherDistance = normBasis(null, 'underground_utilities', 'power_cable', 'tree', 3);

    expect(basisReference(gasShrub, null, '743-ПП, табл. 3.6.1 — газопровод')).toEqual({
      text: '743-ПП, табл. 3.6.1 — газопровод',
      verified: false,
    });
    expect(basisReference(otherDistance, null, CABLE)).toEqual({ text: CABLE, verified: false });
  });

  test('второй акт citation сохраняется, пункт подставляется только своему акту', () => {
    const basis = normBasis(null, 'footpath_edge', null, 'tree', 0.7);

    expect(
      basisReference(
        basis,
        null,
        '743-ПП, табл. 3.6.1; СП 42.13330.2016, табл. 9.1 — край тротуара и садовой дорожки',
      ),
    ).toEqual({
      text: 'ПП Москвы №\u00A0743-ПП, прил. 1, п. 3.6.3, табл. 3.6.1; СП 42.13330.2016, табл. 9.1',
      verified: true,
    });
  });

  test('таблица другого акта или с другим номером — не та же таблица', () => {
    const bed = normBasis(null, 'tram_tracks', 'bed_edge', 'tree', 5);

    expect(
      basisReference(bed, null, 'СП 42.13330.2016, табл. 9.1 — край трамвайного полотна'),
    ).toMatchObject({ verified: true });
    expect(basisReference(bed, null, 'МГСН 1.02-02, табл. 9.1 — край полотна')).toMatchObject({
      verified: false,
    });
    expect(basisReference(bed, null, 'СП 42.13330.2016, табл. 9.10 — другое')).toMatchObject({
      verified: false,
    });
  });

  test('citation другой таблицы или пустой пунктом не дополняется', () => {
    const basis = normBasis(null, 'road_edge', null, 'tree', 2);

    expect(basisReference(basis, null, 'МГСН 1.02-02, табл. 9.1 — проезды')).toEqual({
      text: 'МГСН 1.02-02, табл. 9.1 — проезды',
      verified: false,
    });
    expect(basisReference(basis, null, '')).toEqual({
      text: 'Норма не указана сервером',
      verified: false,
    });
  });
});

describe('normReference с /norms', () => {
  const norm = (act: string, clause: string | null) => ({
    id: 'mgsn-shrub',
    obstacle_category: 'road_edge',
    obstacle_subtype: 'local',
    plant_type: 'shrub' as const,
    distance_m: 1,
    basis: 'regulation' as const,
    citation: '',
    act,
    clause,
    text: '',
    source_url: null,
  });

  test('пункт своего акта — к акту через запятую', () => {
    expect(normReference(norm('ПП Москвы № 743-ПП, прил. 1', 'п. 3.6.3'), '')).toBe(
      'ПП Москвы № 743-ПП, прил. 1, п. 3.6.3',
    );
  });

  test('пункт, который сам называет акт, — без чужого act', () => {
    expect(normReference(norm('623-ПП', '743-ПП, п. 3.6.3, табл. 3.6.1'), '')).toBe(
      '743-ПП, п. 3.6.3, табл. 3.6.1',
    );
    expect(normReference(norm('623-ПП', 'СП 42.13330.2016, табл. 9.1'), '')).toBe(
      'СП 42.13330.2016, табл. 9.1',
    );
  });
});

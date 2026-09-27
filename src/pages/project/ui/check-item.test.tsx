import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import type { PlantingCheck, PlantType } from '@/entities/project';
import { renderWithTheme } from '@/shared/lib/test';

import { CheckItem, CROWN_NOTE } from './check-item';

// Testing Library сводит неразрывные пробелы в тексте узла к обычным: строки ниже — с обычными.
const crownNote = CROWN_NOTE.replaceAll('\u00A0', ' ');

// Проверка по зоне запрета у газопровода: расстояние измерено.
const gasCheck = (plantType: PlantType, distance: number): PlantingCheck => ({
  kind: 'measured',
  zone: {
    index: 0,
    properties: {
      zone_type: 'prohibited',
      plant_type: plantType,
      obstacle_category: 'underground_utilities',
      obstacle_subtype: 'gas',
      distance_m: distance,
      citation: '743-ПП — газопровод',
      reason: '743-ПП — газопровод',
    },
    polygons: [],
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  },
  margin: 1,
  actual: distance + 1,
  planting: [0, 0],
  boundary: [0, 0],
  obstacle: null,
});

const renderCheck = (check: PlantingCheck, plantType: PlantType, crownOverNote = false) =>
  renderWithTheme(
    <ul>
      <CheckItem
        check={check}
        plantType={plantType}
        crownOverNote={crownOverNote}
        onFocus={() => undefined}
        onBlur={() => undefined}
        onShowObstacle={() => undefined}
      />
    </ul>,
  );

describe('пункт проверки', () => {
  test('значение сервиса: нейтральная иконка, «при отступе» и почему нормы в акте нет', () => {
    renderCheck(gasCheck('shrub', 1.5), 'shrub');

    expect(screen.getByRole('img', { name: 'Значение сервиса' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Норма выполнена' })).not.toBeInTheDocument();
    expect(screen.getByText('2,5 м при отступе не менее 1,5 м')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Отступ 1,5 м — консервативное значение сервиса. Для кустарника у газопровода норма в ПП № 743-ПП, табл. 3.6.1, не установлена.',
      ),
    ).toBeInTheDocument();
  });

  test('норма акта: «выполнено», а при кроне больше 5 м — примечание 1', () => {
    renderCheck(gasCheck('tree', 1.5), 'tree', true);

    expect(screen.getByRole('img', { name: 'Норма выполнена' })).toBeInTheDocument();
    expect(screen.getByText('2,5 м при норме не менее 1,5 м')).toBeInTheDocument();
    expect(screen.getByText(crownNote)).toBeInTheDocument();
  });

  test('примечание 1 не относится к значению сервиса', () => {
    renderCheck(gasCheck('shrub', 1.5), 'shrub', true);

    expect(screen.queryByText(crownNote)).not.toBeInTheDocument();
  });
});

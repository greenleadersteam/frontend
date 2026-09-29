import { screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { renderWithTheme } from '@/shared/lib/test';

import { NO_SPECIES_NOTE, type SpeciesRow } from './species-register';
import { SpeciesTable } from './species-table';

const rule = (key: string, plantType: SpeciesRow['plantType'], count: number): SpeciesRow => ({
  key,
  nameRu: `Правило ${key}`,
  nameLat: null,
  plantType,
  count,
  note: NO_SPECIES_NOTE,
});

const RULES = [rule('1', 'tree', 896), rule('2', 'tree', 356), rule('3', 'shrub', 4817)];
const FOOTNOTE = 'Порода не определена сервисом — подбирается при рабочем проектировании';

const headers = () => screen.getAllByRole('columnheader').map(({ textContent }) => textContent);

describe('ведомость озеленения в отчёте', () => {
  test('короткие заголовки; одинаковое примечание — одной сноской, без колонки', () => {
    renderWithTheme(<SpeciesTable rows={RULES} report />);

    expect(headers()).toEqual(['№', 'Наименование', 'Тип', 'Кол-во, шт.']);
    expect(screen.queryByText(NO_SPECIES_NOTE)).not.toBeInTheDocument();
    expect(screen.getByText(FOOTNOTE)).toBeInTheDocument();
  });

  test('у части строк порода есть — колонка остаётся, у породы ячейка пустая', () => {
    const species: SpeciesRow = {
      key: 'species|1',
      nameRu: 'Липа мелколистная',
      nameLat: 'Tilia cordata',
      plantType: 'tree',
      count: 3,
      note: '',
    };
    renderWithTheme(<SpeciesTable rows={[species, ...RULES]} report />);

    expect(headers()).toContain('Примечание');
    expect(screen.queryByText(FOOTNOTE)).not.toBeInTheDocument();
    const lindenRow = screen.getByText('Липа мелколистная').closest('tr');
    if (lindenRow === null) throw new Error('нет строки');
    expect(within(lindenRow).getAllByRole('cell').at(-1)).toBeEmptyDOMElement();
  });

  test('у всех строк порода есть — ни колонки примечаний, ни сноски', () => {
    renderWithTheme(<SpeciesTable rows={RULES.map((row) => ({ ...row, note: '' }))} report />);

    expect(headers()).not.toContain('Примечание');
    expect(screen.queryByText(FOOTNOTE)).not.toBeInTheDocument();
  });

  test('на экране проекта — полные заголовки и колонка примечаний', () => {
    renderWithTheme(<SpeciesTable rows={RULES} />);

    expect(headers()).toEqual(['№ п/п', 'Наименование', 'Тип', 'Количество, шт.', 'Примечание']);
    expect(screen.queryByText(FOOTNOTE)).not.toBeInTheDocument();
  });

  test('граница групп — только у первой строки кустарников', () => {
    renderWithTheme(<SpeciesTable rows={RULES} report />);

    const marked = screen
      .getAllByRole('row')
      .filter((row) => row.hasAttribute('data-group-start'))
      .map((row) => row.textContent);
    expect(marked).toEqual([expect.stringContaining('Правило 3')]);
  });
});

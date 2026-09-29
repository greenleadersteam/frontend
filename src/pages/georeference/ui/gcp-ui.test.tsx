import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { georeferenceReducer, type StoredReference } from '@/entities/georeference';
import { enuFrame } from '@/shared/lib/geodesy';
import { type GcpPair, type Placement, stats, vertexLatLon } from '@/shared/lib/georeference';
import { renderWithProviders, sampleContour } from '@/shared/lib/test';

import { CompareSection } from './compare-section';
import { ContourPanel } from './contour-panel';
import { ExportMenu } from './export-menu';
import { GcpSection } from './gcp-section';
import { ResidualsTable } from './residuals-table';

const render = (ui: ReactNode) => renderWithProviders([{ path: '/', element: ui }], '/');

const TRUTH: Placement = {
  source: sampleContour(),
  anchor: { lat: 55.7431, lon: 37.5908 },
  rotation: 33.75,
  scale: 1,
};

// Пара из вершины контура, с ошибкой в метрах к востоку (как в проверках прототипа).
function pair(index: number, errE = 0): GcpPair {
  const vertex = sampleContour().vertices[index];
  if (vertex === undefined) throw new Error(`нет вершины ${String(index)}`);
  const { lat, lon } = enuFrame(vertexLatLon(vertex, TRUTH)).toGeodetic({ e: errE, n: 0, u: 0 });
  return {
    id: `p${String(index)}`,
    n: index + 1,
    x: vertex.x,
    y: vertex.y,
    lat,
    lon,
    kind: 'vertex',
    enabled: true,
    control: false,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('невязки и оценка', () => {
  const five = [pair(0), pair(1), pair(3, 5), pair(5), pair(7)];
  const summary = stats(TRUTH, five, 500);

  test('ошибка 5 м — строка выброса с пояснением, светофор «Вне допуска»', () => {
    render(
      <>
        <GcpSection
          stats={summary}
          workScale={500}
          handoff={null}
          locked
          active={false}
          pending={false}
          onToggle={vi.fn()}
          vectorScale={50}
          onVectorScale={vi.fn()}
        />
        <ResidualsTable stats={summary} hot={null} onHot={vi.fn()} />
      </>,
    );

    expect(screen.getByText('Вне допуска')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    // Сверху — наибольшая невязка: виновная точка.
    expect(within(rows[0] ?? document.body).getByText('4, выброс')).toBeInTheDocument();
    expect(rows[0]).toHaveAttribute('data-outlier', 'true');
    // Допуск 1:500 — 0,15 м: 5 м выше, и это видно не только цветом.
    expect(
      within(rows[0] ?? document.body).getByRole('img', { name: 'выше допуска' }),
    ).toBeVisible();
    expect(screen.getAllByRole('columnheader').map((th) => th.getAttribute('scope'))).toEqual(
      Array(11).fill('col'),
    );
  });

  test('чистые данные — «В допуске», выбросов нет; две пары — предупреждение о нулевых невязках', () => {
    const clean = stats(TRUTH, [pair(0), pair(1), pair(3), pair(5)], 500);
    const { unmount } = render(
      <GcpSection
        stats={clean}
        workScale={500}
        handoff={null}
        locked
        active={false}
        pending={false}
        onToggle={vi.fn()}
        vectorScale={50}
        onVectorScale={vi.fn()}
      />,
    );
    expect(screen.getByText('В допуске')).toBeInTheDocument();
    expect(screen.queryByText(/тождественно нулевые/)).not.toBeInTheDocument();
    unmount();

    render(
      <GcpSection
        stats={stats(TRUTH, [pair(0), pair(3)], 500)}
        workScale={500}
        handoff={null}
        locked
        active={false}
        pending={false}
        onToggle={vi.fn()}
        vectorScale={50}
        onVectorScale={vi.fn()}
      />,
    );
    expect(screen.getByText(/невязки тождественно нулевые/)).toBeInTheDocument();
  });

  test('большое смещение при передаче управления точкам — предупреждение и «Вернуть ручное»', () => {
    render(
      <GcpSection
        stats={summary}
        workScale={500}
        handoff={{
          anchor: TRUTH.anchor,
          rotation: 0,
          scale: 1,
          count: 2,
          shift: 5000,
          rotationChange: 3,
          big: true,
        }}
        locked
        active={false}
        pending={false}
        onToggle={vi.fn()}
        vectorScale={50}
        onVectorScale={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/^Большое смещение — проверьте, что точки пары соответствуют друг другу/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Вернуть ручное' })).toBeInTheDocument();
  });
});

describe('сравнение с эталоном', () => {
  const reference = (rotation: number): StoredReference => ({
    id: 'ref-1',
    seq: 1,
    name: 'эталон.json',
    origin: null,
    created: '2026-09-23T14:05:00 UTC+03:00',
    kind: 'json',
    anchor: TRUTH.anchor,
    rotation,
    scale: 1,
    polygons: [],
    counts: { polygons: 0, rings: 0, vertices: 0 },
    visible: true,
  });

  test.each([
    [10, 350, '20,000°'],
    [350, 10, '−20,000°'],
    [0, 30, '−30,000°'],
    [30, 0, '30,000°'],
  ])('текущая %d° против эталона %d° — %s', (current, ref, expected) => {
    render(
      <CompareSection placement={{ ...TRUTH, rotation: current }} references={[reference(ref)]} />,
    );
    expect(screen.getByText('Разница поворота').nextSibling).toHaveTextContent(expected);
    expect(screen.getByText('Сдвиг опорной точки').nextSibling).toHaveTextContent('0,000 м');
  });

  test('несколько эталонов — разброс по положению и повороту, включая текущую', () => {
    render(
      <CompareSection
        placement={{ ...TRUTH, rotation: 10 }}
        references={[reference(350), { ...reference(12), id: 'ref-2', seq: 2 }]}
      />,
    );
    expect(screen.getByText('Разброс по повороту').nextSibling).toHaveTextContent('22,000°');
    expect(screen.getByText(/между 3 привязками, включая текущую/)).toBeInTheDocument();
  });
});

describe('невязка выше допуска', () => {
  test('значок «выше допуска» — только у точек с невязкой больше допуска масштаба работ', () => {
    // Допуск 1:500 — 0,15 м; ошибка 0,5 м у одной точки поднимает невязку выше него.
    const summary = stats(TRUTH, [pair(0), pair(1), pair(3, 0.5), pair(5), pair(7)], 500);
    render(<ResidualsTable stats={summary} hot={null} onHot={vi.fn()} />);

    const over = screen
      .getAllByRole('row')
      .slice(1)
      .filter((row) => within(row).queryByRole('img', { name: 'выше допуска' }) !== null);
    expect(over.length).toBeGreaterThan(0);
    for (const row of over) {
      const ds = Number(within(row).getAllByRole('cell')[8]?.textContent.replace(',', '.'));
      expect(ds).toBeGreaterThan(summary.tolerance);
    }
    expect(over.length).toBeLessThan(5);
  });
});

describe('поиск эталонов', () => {
  const stored = (id: string, name: string): StoredReference => ({
    id,
    seq: 1,
    name,
    origin: null,
    created: '2026-09-23T14:05:00 UTC+03:00',
    kind: 'json',
    anchor: TRUTH.anchor,
    rotation: 0,
    scale: 1,
    polygons: [],
    counts: { polygons: 0, rings: 0, vertices: 0 },
    visible: true,
  });

  test('по названию, без учёта регистра и «ё»; пусто — «Сбросить поиск»', async () => {
    const session = {
      ...georeferenceReducer(undefined, { type: 'test/empty' }),
      references: [stored('a', 'Берёзовая аллея.json'), stored('b', 'Сквер.json')],
    };
    render(
      <ContourPanel
        project={null}
        onPlanVisible={vi.fn()}
        session={session}
        fillOpacity={0.2}
        onFillOpacity={vi.fn()}
        contourVisible
        onContourVisible={vi.fn()}
        onFiles={vi.fn()}
        onExample={vi.fn()}
        onFit={vi.fn()}
        disabled={false}
        locked={false}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Поиск эталона по названию' });

    await userEvent.type(field, 'БЕРЕЗ');
    expect(screen.getByText('Берёзовая аллея.json')).toBeInTheDocument();
    expect(screen.queryByText('Сквер.json')).not.toBeInTheDocument();

    await userEvent.type(field, 'x');
    expect(screen.getByText('Нет эталонов с таким названием')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Сбросить поиск' }));
    expect(screen.getByText('Сквер.json')).toBeInTheDocument();
    expect(field).toHaveValue('');
  });
});

describe('выгрузка', () => {
  const downloads = () => {
    const names: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:выгрузка');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    return names;
  };

  test('три формата — файлы с именем от контура', async () => {
    const names = downloads();
    render(<ExportMenu placement={TRUTH} gcp={[]} workScale={500} />);

    for (const item of [
      'JSON — параметры и каталог',
      'CSV — каталог координат',
      'GeoJSON — контур в WGS84',
    ]) {
      await userEvent.click(screen.getByRole('button', { name: 'Выгрузить' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: item }));
    }

    expect(names).toEqual([
      'Участок-образец — привязка.json',
      'Участок-образец — привязка.csv',
      'Участок-образец — привязка.geojson',
    ]);
  });

  test('самопроверка не прошла — уведомление, файла нет', async () => {
    const names = downloads();
    // Настоящие участки самопроверку проходят (Г2: допуск от размера участка), поэтому отказ
    // вызывается положением, которое в файл не записать: широта не число.
    render(
      <ExportMenu
        placement={{ ...TRUTH, anchor: { lat: NaN, lon: TRUTH.anchor.lon } }}
        gcp={[]}
        workScale={500}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Выгрузить' }));
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'JSON — параметры и каталог' }),
    );

    expect(await screen.findByText(/^Выгрузка не прошла самопроверку/)).toBeInTheDocument();
    expect(names).toEqual([]);
  });
});

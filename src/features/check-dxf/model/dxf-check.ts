import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { PLANTING_LAYER } from '@/entities/project';
import { PRODUCT_NAME } from '@/shared/config';
import type { DxfComparison, LayerComparison } from '@/shared/lib/dxf-compare';
import { formatCount, formatNumber } from '@/shared/lib/format';

type CheckedFile = { name: string; size: number };

// Последняя проверка чертежа проекта до перезагрузки страницы: её показывает отчёт для согласования.
// Сравнение не сохраняется ни на сервере, ни в браузере — это протокол, который скачивают.
export type DxfCheck = {
  checkedAt: string;
  source: CheckedFile;
  result: CheckedFile;
  // Версия плана посадок, чей DXF проверен; null — сервер без версий, /dxf.
  version: number | null;
  comparison: DxfComparison;
};

type DxfCheckState = Record<string, DxfCheck>;

const initialState: DxfCheckState = {};

export const dxfCheckSlice = createSlice({
  name: 'dxfCheck',
  initialState,
  reducers: {
    checked(state, { payload }: PayloadAction<{ projectId: string; check: DxfCheck }>) {
      state[payload.projectId] = payload.check;
    },
  },
  selectors: {
    selectDxfCheck: (state, projectId: string): DxfCheck | null => state[projectId] ?? null,
  },
});

export const { checked } = dxfCheckSlice.actions;
export const { selectDxfCheck } = dxfCheckSlice.selectors;

const LAYER_FORMS = { one: 'слой', few: 'слоя', many: 'слоёв' };
const ENTITY_FORMS = { one: 'сущность', few: 'сущности', many: 'сущностей' };

type Verdict =
  | { kind: 'unchanged'; text: string }
  | { kind: 'changed'; text: string }
  | { kind: 'refused'; text: string };

const REFUSED = {
  binary: {
    source:
      'Исходный чертёж — двоичный DXF: браузер его не разбирает. Сохраните чертёж в САПР как ASCII DXF и проверьте снова.',
    result:
      'Сервер вернул двоичный DXF — так он сохраняет результат двоичной подосновы. Браузер его не разбирает: сравните слои в САПР.',
  },
  invalid: {
    source:
      'Исходный файл не читается как DXF: нет версии чертежа или файл обрывается. Выберите главный чертёж из загруженного архива.',
    result: 'Результат сервиса не читается как DXF. Скачайте DXF заново и повторите проверку.',
  },
} as const;

// Сравнивать нечего или сравнивается не то: зелёный вердикт здесь был бы неправдой.
const NO_ENTITIES =
  'В исходном файле нет сущностей чертежа. Выберите главный чертёж из загруженного архива.';
const RESULT_AS_SOURCE = `В исходном файле уже есть слой результата «${PLANTING_LAYER}»: похоже, выбран сам результат сервиса. Выберите главный чертёж из загруженного архива.`;

const originalLayers = (layers: LayerComparison[]) =>
  layers.filter(({ status }) => status !== 'added');

export function dxfVerdict(comparison: DxfComparison): Verdict {
  if (comparison.kind !== 'compared') {
    return { kind: 'refused', text: REFUSED[comparison.kind][comparison.file] };
  }
  const original = originalLayers(comparison.layers);
  if (original.length === 0) return { kind: 'refused', text: NO_ENTITIES };
  const differing = original.filter(({ status }) => status !== 'same');
  if (differing.length > 0) {
    return {
      kind: 'changed',
      text: `Исходные слои изменены: ${formatCount(differing.length, LAYER_FORMS)} из ${formatNumber(original.length)}.`,
    };
  }
  // Без посадок сервис слоя результата не пишет, так что его отсутствие — не ошибка. А вот слой
  // результата в исходном файле значит, что вместо исходника выбран результат.
  if (original.some(({ name, source }) => name === PLANTING_LAYER && source > 0)) {
    return { kind: 'refused', text: RESULT_AS_SOURCE };
  }
  const entities = original.reduce((sum, layer) => sum + layer.source, 0);
  return {
    kind: 'unchanged',
    text: `Исходные слои не изменены. Совпадение: ${formatCount(original.length, LAYER_FORMS)}, ${formatCount(entities, ENTITY_FORMS)}.`,
  };
}

export const addedLayers = (comparison: DxfComparison): LayerComparison[] =>
  comparison.kind === 'compared'
    ? comparison.layers.filter(({ status }) => status === 'added')
    : [];

export const addedLayerLine = ({ name, result }: LayerComparison): string =>
  `Добавлен слой «${name}»: ${formatCount(result, ENTITY_FORMS)}.`;

export const differingLayers = (comparison: DxfComparison): LayerComparison[] =>
  comparison.kind === 'compared'
    ? originalLayers(comparison.layers).filter(({ status }) => status !== 'same')
    : [];

export function differenceLine({
  name,
  status,
  source,
  result,
  missing,
  extra,
}: LayerComparison): string {
  if (status === 'removed')
    return `Слой «${name}» удалён: было ${formatCount(source, ENTITY_FORMS)}.`;
  const parts = [
    ...(missing > 0 ? [`из исходных не найдено ${formatNumber(missing)}`] : []),
    ...(extra > 0 ? [`новых или изменённых ${formatNumber(extra)}`] : []),
  ];
  return `Слой «${name}»: было ${formatCount(source, ENTITY_FORMS)}, стало ${formatNumber(result)}; ${parts.join(', ')}.`;
}

// Протокол для эксперта: что сравнивалось, с чем и что вышло — без интерфейса и без сервера.
export function dxfProtocol(project: { id: string; name: string }, check: DxfCheck): string {
  const { comparison } = check;
  const verdict = dxfVerdict(comparison);
  return JSON.stringify(
    {
      protocol: 'Проверка чертежа',
      service: PRODUCT_NAME,
      project: { id: project.id, name: project.name },
      checkedAt: check.checkedAt,
      source: {
        ...check.source,
        dxfVersion: comparison.kind === 'compared' ? comparison.sourceVersion : null,
      },
      result: {
        ...check.result,
        dxfVersion: comparison.kind === 'compared' ? comparison.resultVersion : null,
        planVersion: check.version,
      },
      method:
        'Сущности секций ENTITIES и BLOCKS по слоям (групповой код 8): число и хеш содержимого каждой сущности; VERTEX, SEQEND и ATTRIB входят в свою POLYLINE или INSERT. Числа сравниваются как числа. Не сравниваются handle (код 5), владелец (код 330), $HANDSEED и даты сохранения в HEADER: их переписывает любое сохранение файла.',
      verdict: { kind: verdict.kind, text: verdict.text },
      layers: comparison.kind === 'compared' ? comparison.layers : [],
    },
    null,
    2,
  );
}

import { PLANT_TYPE_LABELS, VERIFIED_CLAUSE_NOTE, type VerifiedClause } from '@/entities/project';
import { formatMeters } from '@/shared/lib/format';
import type { XlsxCell, XlsxSheet } from '@/shared/lib/xlsx';

import type { ReportCheck, ReportPlanting } from '../model/report';
import { CROWN_NOTE } from './check-item';
import { basisReference, verifiedClauseFor } from './norm-reference';

export const NO_CHECKS_TEXT = 'Рядом нет ограничений из проверяемых сервисом';

// В таблице проверок основание короткое: пункт или «значение сервиса». Акт, текст причины
// и источник — один раз, в «Применённых нормах»: иначе каждая строка повторяла бы абзац.
export const shortBasis = ({ basis, norm, citation }: ReportCheck): string =>
  basis?.basis === 'service_default'
    ? 'значение сервиса'
    : (shortClause(verifiedClauseFor(basis, citation)) ?? norm?.clause ?? citation);

// Пункт из сверки помечен и в короткой ссылке: сервер его не присылал.
const shortClause = (verified: VerifiedClause | null): string | null =>
  verified === null ? null : `${verified.clause} (по сверке)`;

// В Excel строка читается без раздела «Применённые нормы»: у сверенного пункта — ссылка как в
// карточке, со всеми актами citation, и пометка.
const sheetBasis = (check: ReportCheck): string => {
  const reference = basisReference(check.basis, check.norm, check.citation);
  return reference.verified ? `${reference.text} (${VERIFIED_CLAUSE_NOTE})` : shortBasis(check);
};

export const resultText = (check: ReportCheck): string =>
  check.violated
    ? check.basis?.basis === 'service_default'
      ? 'Отступ сервиса нарушен'
      : 'Нарушено'
    : check.basis?.basis === 'service_default'
      ? 'Значение сервиса'
      : check.withinTolerance
        ? 'В пределах точности'
        : 'Выполнено';

export const hasCrownNote = (planting: ReportPlanting): boolean =>
  planting.crownOverNote && planting.checks.some(({ basis }) => basis?.basis === 'regulation');

// Точность — как в таблице: до объекта с сантиметрами, через зону — с точностью хорды буфера.
const measured = (check: ReportCheck): number | null => {
  switch (check.kind) {
    case 'object':
      return Math.round(check.actual * 100) / 100;
    case 'measured':
      return Math.round(check.actual * 10) / 10;
    case 'boundary':
    case 'inside':
      return null;
    default: {
      const unexpected: never = check;
      return unexpected;
    }
  }
};

// Когда фактического расстояния нет, примечание объясняет почему.
const measuredNote = (check: ReportCheck): string | null =>
  check.kind === 'boundary'
    ? `до границы зоны ${formatMeters(check.margin, 1)}`
    : check.kind === 'inside'
      ? 'внутри зоны запрета'
      : null;

// Все проверки по всем посадкам — для Excel: в отчёте для согласования только выборка, а
// полная таблица на тысячи строк нужна для разбора, а не для печати. Строка — одна проверка.
export function checksSheet(plantings: readonly ReportPlanting[]): XlsxSheet {
  const rows = plantings.flatMap((planting): XlsxCell[][] => {
    const type = PLANT_TYPE_LABELS[planting.plantType];
    const crown = hasCrownNote(planting) ? CROWN_NOTE : null;
    if (planting.checks.length === 0) {
      return [[planting.id, type, NO_CHECKS_TEXT, null, null, null, null, null]];
    }
    return planting.checks.map((check) => [
      planting.id,
      type,
      check.object,
      measured(check),
      check.required,
      sheetBasis(check),
      resultText(check),
      measuredNote(check) ?? (check.basis?.basis === 'regulation' ? crown : null),
    ]);
  });
  const checks = plantings.flatMap(({ checks: list }) => list);
  return {
    name: 'Проверки по посадкам',
    header: [
      'Посадка',
      'Тип',
      'Объект',
      'Фактически, м',
      'Требуется не менее, м',
      'Основание',
      'Итог',
      'Примечание',
    ],
    rows,
    totals: [
      ['Итого посадок', plantings.length],
      ['Итого проверок', checks.length],
      ['Нарушено', checks.filter(({ violated }) => violated).length],
    ],
  };
}

import {
  type Norm,
  type NormBasis,
  type VerifiedClause,
  verifiedReference,
} from '@/entities/project';

// Ссылка на норму так, как её пишут специалисты: «ПП Москвы от 10.09.2002 № 743-ПП, прил. 1,
// п. 3.6.3, табл. 3.6.1, …». Пункт — только подтверждённый для этого типа посадки (/norms,
// clause); без него — акт без пункта. Без записи /norms — строка citation сервера.
export function normReference(norm: Norm | null, citation: string): string {
  if (norm?.act == null) return citation.trim() === '' ? 'Норма не указана сервером' : citation;
  if (norm.clause === null) return norm.act;
  // Пункт другого акта (у кустарника по МГСН — «743-ПП, п. 3.6.3…» при act «623-ПП») сам
  // называет акт: приклеенный к act, он читался бы как пункт чужого документа.
  return OWN_ACT.test(norm.clause) ? norm.clause : `${norm.act}, ${norm.clause}`;
}

// Пункт начинается с обозначения акта: «743-ПП, …», «СП 42…», «МГСН 1.02-02…», «ПУЭ…».
const OWN_ACT = /^(\d+-ПП|СП\s|МГСН\s|ПУЭ)/;

type BasisReference = { text: string; verified: boolean };

// Акты в citation сервера — до « — », через «;»: «743-ПП, табл. 3.6.1; СП 42.13330.2016,
// табл. 9.1 — край тротуара».
const citedActs = (citation: string): string[] =>
  (citation.split(' — ')[0] ?? '').split(';').map((act) => act.trim());

// Ссылка на тот же акт и ту же таблицу: «табл. 9.1» не совпадает с «табл. 9.10» и с таблицей
// другого акта.
const citesClause = (act: string, { actMark, table }: VerifiedClause): boolean =>
  act.includes(actMark) && new RegExp(`${table.replaceAll('.', '\\.')}(?![\\d.])`).test(act);

// Пункт из сверки с текстом акта — если норма сервиса с ней совпала (norm-basis.ts) и citation
// сервера ссылается на тот же акт и ту же таблицу. Пустой или чужой citation пунктом не
// дополняется.
export function verifiedClauseFor(
  basis: NormBasis | null,
  citation: string,
): VerifiedClause | null {
  if (basis?.basis !== 'regulation' || basis.verified === null) return null;
  const { verified } = basis;
  return citedActs(citation).some((act) => citesClause(act, verified)) ? verified : null;
}

// Ссылка для требования акта: сверенный акт с пунктом, остальные акты citation — как у сервера
// («…, табл. 3.6.1; СП 42.13330.2016, табл. 9.1»). verified — пункт дала сверка, а не сервер.
export function basisReference(
  basis: NormBasis | null,
  norm: Norm | null,
  citation: string,
): BasisReference {
  const verified = verifiedClauseFor(basis, citation);
  if (verified === null) return { text: normReference(norm, citation), verified: false };
  const acts = citedActs(citation).map((act) =>
    citesClause(act, verified) ? verifiedReference(verified) : act,
  );
  return { text: acts.join('; '), verified: true };
}

// Где эксперт найдёт, откуда взят пункт.
export const VERIFIED_CLAUSE_HINT =
  'сервер присылает только таблицу, сверка — в отчёте для согласования, раздел «Применённые нормы»';

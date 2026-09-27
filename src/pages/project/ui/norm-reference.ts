import type { Norm } from '@/entities/project';

// Ссылка на норму так, как её пишут специалисты: «ПП Москвы от 10.09.2002 № 743-ПП, прил. 1,
// п. 3.6.3, табл. 3.6.1, …». Пункт — только подтверждённый для этого типа посадки (/norms,
// clause); без него — акт без пункта. Без записи /norms — строка citation сервера.
export function normReference(norm: Norm | null, citation: string): string {
  if (norm?.act == null) return citation.trim() === '' ? 'Норма не указана сервером' : citation;
  return norm.clause === null ? norm.act : `${norm.act}, ${norm.clause}`;
}

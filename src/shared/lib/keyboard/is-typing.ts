// Поля ввода печатают сами: сочетания клавиш редакторов в них не перехватываются. Флажок
// и переключатель (input type=checkbox) этих клавиш не используют — с фокусом на них сочетания
// работают.
export const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  !(target instanceof HTMLInputElement && target.type === 'checkbox') &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

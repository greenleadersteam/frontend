export const paths = {
  projects: '/',
  projectNew: '/projects/new',
  project: '/projects/:projectId',
} as const;

export const projectPath = (projectId: string): string =>
  `/projects/${encodeURIComponent(projectId)}`;

// Мастер загрузки для существующего проекта: шаг «Архив» или выбор главного чертежа.
export const projectUploadPath = (projectId: string): string =>
  `${paths.projectNew}?project=${encodeURIComponent(projectId)}`;

// Состояние перехода к списку после удаления проекта: список переводит фокус на свой
// заголовок, а не оставляет его на исчезнувшей кнопке. Состояние истории — недоверенное.
export const FOCUS_PROJECTS_HEADING = { focus: 'projects-heading' } as const;

export const isFocusProjectsHeading = (state: unknown): boolean =>
  typeof state === 'object' &&
  state !== null &&
  'focus' in state &&
  state.focus === FOCUS_PROJECTS_HEADING.focus;

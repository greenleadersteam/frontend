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

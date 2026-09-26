export const paths = {
  projects: '/',
  projectNew: '/projects/new',
  project: '/projects/:projectId',
} as const;

export const projectPath = (projectId: string): string =>
  `/projects/${encodeURIComponent(projectId)}`;

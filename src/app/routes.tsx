import type { RouteObject } from 'react-router';

import { paths } from '@/shared/config';

import { AppLayout } from './layout/app-layout';
import { RouteErrorBoundary } from './route-error-boundary';

// Песочница оформления нужна только разработчику. Условие статическое: в production
// import.meta.env.DEV === false, и сборщик выбрасывает маршрут вместе с его чанком.
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: '/dev/ui',
        lazy: async () => ({ Component: (await import('@/pages/dev-ui')).DevUiPage }),
      },
    ]
  : [];

export const routes: RouteObject[] = [
  {
    ErrorBoundary: RouteErrorBoundary,
    children: [
      {
        element: <AppLayout width="contained" />,
        children: [
          {
            path: paths.projects,
            lazy: async () => ({ Component: (await import('@/pages/projects')).ProjectsPage }),
          },
          {
            path: paths.projectReport,
            lazy: async () => ({
              Component: (await import('@/pages/project')).ProjectReportPage,
            }),
          },
          {
            path: paths.projectNew,
            lazy: async () => ({
              Component: (await import('@/pages/project-new')).ProjectNewPage,
            }),
          },
          ...devRoutes,
          {
            path: '*',
            lazy: async () => ({ Component: (await import('@/pages/not-found')).NotFoundPage }),
          },
        ],
      },
      {
        element: <AppLayout width="full" />,
        children: [
          {
            path: paths.project,
            lazy: async () => ({ Component: (await import('@/pages/project')).ProjectPage }),
          },
        ],
      },
    ],
  },
];

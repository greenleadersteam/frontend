import type { JSX } from 'react';
import { Outlet } from 'react-router';

import { AppHeader } from '@/widgets/app-header';

import classes from './app-layout.module.css';

type AppLayoutProps = {
  // Экран проекта с картой занимает всю ширину, остальные — не шире 1280px (design.md).
  width: 'contained' | 'full';
  // Экран-инструмент ровно в высоту окна: карта от шапки до низа, панели прокручиваются сами.
  viewport?: boolean;
};

export function AppLayout({ width, viewport = false }: AppLayoutProps): JSX.Element {
  return (
    <div className={classes.root} data-width={width} data-viewport={viewport || undefined}>
      {/* Шапка и метка режима не печатаются: печатная страница — документ (отчёт). */}
      <div className={classes.chrome}>
        <AppHeader />
      </div>
      <main className={classes.main}>
        <Outlet />
      </main>
    </div>
  );
}

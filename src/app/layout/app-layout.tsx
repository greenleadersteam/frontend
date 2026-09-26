import type { JSX } from 'react';
import { Outlet } from 'react-router';

import { AppHeader } from '@/widgets/app-header';

import classes from './app-layout.module.css';

type AppLayoutProps = {
  // Экран проекта с картой занимает всю ширину, остальные — не шире 1280px (design.md).
  width: 'contained' | 'full';
};

export function AppLayout({ width }: AppLayoutProps): JSX.Element {
  return (
    <div className={classes.root} data-width={width}>
      <AppHeader />
      <main className={classes.main}>
        <Outlet />
      </main>
    </div>
  );
}

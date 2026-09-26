import { Group } from '@mantine/core';
import type { JSX } from 'react';
import { Link, NavLink } from 'react-router';

import { paths, PRODUCT_NAME } from '@/shared/config';
import { Logo } from '@/shared/ui';

import classes from './app-header.module.css';

export function AppHeader(): JSX.Element {
  return (
    <header className={classes.root}>
      <Link to={paths.projects} className={classes.brand}>
        <Logo />
        <span className={classes.brandName}>{PRODUCT_NAME}</span>
      </Link>
      <nav aria-label="Основная навигация">
        <Group gap="xl" component="ul" className={classes.list}>
          {/* NavLink сам ставит aria-current="page" на активный пункт; end — чтобы «Проекты» не были активны на вложенных адресах. */}
          <li>
            <NavLink to={paths.projects} end className={classes.link}>
              Проекты
            </NavLink>
          </li>
          <li>
            <NavLink to={paths.projectNew} className={classes.link}>
              Новый проект
            </NavLink>
          </li>
        </Group>
      </nav>
    </header>
  );
}

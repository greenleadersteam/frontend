import { Group } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import type { JSX } from 'react';
import { Link, NavLink } from 'react-router';

import {
  currentDataSource,
  getRuntimeConfig,
  paths,
  PRODUCT_NAME,
  PRODUCT_TEAM,
} from '@/shared/config';
import { Logo } from '@/shared/ui';

import classes from './app-header.module.css';
import { DataSourceSwitch } from './data-source-switch';
import { DemoBanner } from './demo-banner';

// На узком экране подпись команды уступает место навигации.
const TEAM_CAPTION_QUERY = '(min-width: 64em)';

export function AppHeader(): JSX.Element {
  const demoAvailable = getRuntimeConfig().demoMode === 'available';
  const teamCaption = useMediaQuery(TEAM_CAPTION_QUERY, false, { getInitialValueInEffect: false });

  return (
    <div className={classes.wrapper}>
      <header className={classes.root}>
        <div className={classes.start}>
          <Link to={paths.projects} className={classes.brand}>
            <Logo />
            {/* Имя ссылки даёт alt знака: видимое название читалке не повторяется. */}
            <span className={classes.brandName} aria-hidden>
              {PRODUCT_NAME}
            </span>
            {teamCaption && <span className={classes.team}>{`by ${PRODUCT_TEAM}`}</span>}
          </Link>
          {demoAvailable && <DataSourceSwitch />}
        </div>
        <nav aria-label="Основная навигация">
          <Group gap="xl" component="ul" className={classes.list}>
            {/* NavLink сам ставит aria-current="page" на активный пункт; end — чтобы «Проекты» не были активны на вложенных адресах. */}
            <li>
              <NavLink to={paths.projects} end className={classes.link}>
                Проекты
              </NavLink>
            </li>
            <li>
              <NavLink to={paths.georeference} className={classes.link}>
                Геопривязка
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
      {currentDataSource() === 'demo' && <DemoBanner />}
    </div>
  );
}

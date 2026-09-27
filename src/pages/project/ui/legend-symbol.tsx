import type { JSX } from 'react';

import { utilityStyles, type UtilitySubtype } from '@/shared/theme';

import classes from './legend-symbol.module.css';

type LegendSymbolProps =
  | {
      kind:
        | 'trees'
        | 'shrubs'
        | 'zones'
        | 'allowed'
        | 'lawn'
        | 'siteBoundary'
        | 'utilities'
        | 'buildings'
        | 'edges'
        | 'rejected'
        | 'basemap'
        | 'manual'
        | 'statusForbidden'
        | 'statusRejected';
    }
  // Знак одной сети: её цвет и рисунок линии.
  | { kind: 'utility'; utility: UtilitySubtype };

// Условный знак — уменьшенная копия того, как слой нарисован на карте (design.md, «Карта»):
// крона с бликом, круг кустарника, заливка со штриховкой, газон и «можно» поверх него, пунктир
// границы, линии сетей, здание, кромка, фрагмент подложки с дорогой, ромб добавленной вручную
// и кольца статусов правленых посадок.
export function LegendSymbol(props: LegendSymbolProps): JSX.Element {
  const { kind } = props;
  return (
    <svg viewBox="0 0 16 16" className={classes.symbol} aria-hidden>
      {kind === 'trees' && (
        <>
          <circle cx="8" cy="8" r="6.5" className={classes.tree} />
          <circle cx="6" cy="6" r="2.9" className={classes.treeHighlight} />
        </>
      )}
      {kind === 'shrubs' && <circle cx="8" cy="8" r="5" className={classes.shrub} />}
      {kind === 'zones' && (
        <>
          <rect x="1" y="1" width="14" height="14" rx="2" className={classes.zone} />
          <path d="M1 7 7 1M1 12 12 1M4 15 15 4M9 15 15 9" className={classes.zoneHatch} />
        </>
      )}
      {(kind === 'lawn' || kind === 'allowed') && (
        <>
          <rect x="1" y="1" width="14" height="14" rx="2" className={classes.lawnEarth} />
          <rect x="1" y="1" width="14" height="14" rx="2" className={classes.lawn} />
          {kind === 'allowed' && (
            <rect x="1" y="1" width="14" height="14" rx="2" className={classes.allowed} />
          )}
        </>
      )}
      {kind === 'siteBoundary' && <path d="M1 8h14" className={classes.siteBoundary} />}
      {kind === 'utilities' && (
        <>
          <path d="M1 3.5h14" className={classes.utility} data-utility="gas" data-dash="solid" />
          <path d="M1 8h14" className={classes.utility} data-utility="sewer" data-dash="dashed" />
          <path
            d="M1 12.5h14"
            className={classes.utility}
            data-utility="power_cable"
            data-dash="dashDot"
          />
        </>
      )}
      {props.kind === 'utility' && (
        <path
          d="M1 8h14"
          className={classes.utility}
          data-utility={props.utility}
          data-dash={utilityStyles[props.utility].dash}
        />
      )}
      {kind === 'buildings' && (
        <rect x="2" y="3" width="12" height="10" className={classes.building} />
      )}
      {kind === 'edges' && <path d="M1 8h14" className={classes.edge} />}
      {kind === 'rejected' && (
        <>
          <circle cx="8" cy="8" r="6" className={classes.rejectedRing} />
          <path d="M5.5 5.5l5 5M5.5 10.5l5-5" className={classes.rejectedCross} />
        </>
      )}
      {kind === 'manual' && (
        <>
          <circle cx="8" cy="8" r="6.5" className={classes.tree} />
          <path d="M8 4.5 11.5 8 8 11.5 4.5 8Z" className={classes.manual} />
        </>
      )}
      {(kind === 'statusForbidden' || kind === 'statusRejected') && (
        <>
          <circle cx="8" cy="8" r="4.5" className={classes.tree} />
          <circle
            cx="8"
            cy="8"
            r="6.5"
            className={classes.statusRing}
            data-dash={kind === 'statusRejected' ? 'dashed' : 'solid'}
          />
        </>
      )}
      {kind === 'basemap' && (
        <>
          <rect x="1" y="1" width="14" height="14" rx="2" className={classes.earth} />
          <path d="M1 10h14" className={classes.roadCasing} />
          <path d="M1 10h14" className={classes.road} />
        </>
      )}
    </svg>
  );
}

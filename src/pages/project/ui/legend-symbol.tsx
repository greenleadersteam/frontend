import type { JSX } from 'react';

import classes from './legend-symbol.module.css';

type LegendSymbolProps = {
  kind: 'trees' | 'shrubs' | 'zones' | 'lawn' | 'siteBoundary' | 'basemap';
};

// Условный знак — уменьшенная копия того, как слой нарисован на карте (design.md, «Карта»):
// крона с бликом, круг кустарника, заливка со штриховкой, газон, пунктир границы, фрагмент
// подложки с дорогой.
export function LegendSymbol({ kind }: LegendSymbolProps): JSX.Element {
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
      {kind === 'lawn' && (
        <>
          <rect x="1" y="1" width="14" height="14" rx="2" className={classes.lawnEarth} />
          <rect x="1" y="1" width="14" height="14" rx="2" className={classes.lawn} />
        </>
      )}
      {kind === 'siteBoundary' && <path d="M1 8h14" className={classes.siteBoundary} />}
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

import type { JSX } from 'react';

import classes from './georeference-page.module.css';

type ReadoutProps = {
  // Название и значение; значения — табличными цифрами, по правому краю.
  rows: readonly (readonly [term: string, value: string])[];
};

export function Readout({ rows }: ReadoutProps): JSX.Element {
  return (
    <dl className={classes.readoutList}>
      {rows.map(([term, value]) => (
        <div key={term} className={classes.readoutRow}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

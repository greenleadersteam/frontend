import type { JSX } from 'react';

import {
  addedLayerLine,
  addedLayers,
  differenceLine,
  differingLayers,
  type DxfCheck,
} from '../model/dxf-check';
import classes from './dxf-check-lines.module.css';

type DxfCheckLinesProps = { check: DxfCheck };

// Строки под вердиктом: какие слои добавил сервис и чем отличаются исходные — на странице
// проверки и в отчёте для согласования.
export function DxfCheckLines({ check }: DxfCheckLinesProps): JSX.Element | null {
  const added = addedLayers(check.comparison);
  const differing = differingLayers(check.comparison);
  if (added.length === 0 && differing.length === 0) return null;
  return (
    <ul className={classes.lines}>
      {added.map((layer) => (
        <li key={layer.name}>{addedLayerLine(layer)}</li>
      ))}
      {differing.map((layer) => (
        <li key={layer.name}>{differenceLine(layer)}</li>
      ))}
    </ul>
  );
}

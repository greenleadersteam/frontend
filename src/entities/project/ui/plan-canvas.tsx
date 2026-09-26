import { useMergedRef, useResizeObserver } from '@mantine/hooks';
import { type JSX, useEffect, useRef } from 'react';

import type { PlantingFeatureCollection, ZonesFeatureCollection } from '../api/project-result-api';
import { drawPlan } from './draw-plan';
import classes from './plan-canvas.module.css';

type PlanCanvasProps = {
  planting: PlantingFeatureCollection;
  zones: ZonesFeatureCollection;
  // Без подписи холст декоративен: план рядом описан текстом.
  label?: string;
};

// План посадок на canvas без подложки: превью в списке и запасной вид экрана проекта.
export function PlanCanvas({ planting, zones, label }: PlanCanvasProps): JSX.Element {
  const [sizeRef, rect] = useResizeObserver<HTMLCanvasElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ref = useMergedRef(sizeRef, canvasRef);

  // Перерисовка — синхронизация холста с данными и размером; повторного запроса нет.
  useEffect(() => {
    if (canvasRef.current === null) return;
    drawPlan(canvasRef.current, { planting, zones }, rect.width, rect.height);
  }, [planting, zones, rect.width, rect.height]);

  return label === undefined ? (
    <canvas ref={ref} className={classes.canvas} aria-hidden />
  ) : (
    <canvas ref={ref} className={classes.canvas} role="img" aria-label={label} />
  );
}

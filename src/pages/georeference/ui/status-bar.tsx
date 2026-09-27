import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { type JSX, useEffect, useRef } from 'react';

import {
  DASH,
  formatLatLon,
  formatMapScale,
  formatMetersPerPixel,
} from '@/shared/lib/georeference';

import { metersPerPixel, scaleDenominator } from '../lib/contour-geometry';
import classes from './georeference-page.module.css';

type StatusBarProps = { map: MapLibreMap | null };

// Координаты курсора, масштаб и метры на пиксель. Текст меняется на каждое движение мыши,
// поэтому пишется в DOM напрямую, без перерисовки React.
export function StatusBar({ map }: StatusBarProps): JSX.Element {
  const cursor = useRef<HTMLSpanElement>(null);
  const scale = useRef<HTMLSpanElement>(null);
  const mpp = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (map === null) return;
    let frame: number | null = null;
    const showView = () => {
      frame = null;
      const canvas = map.getCanvas();
      const center: [number, number] = [canvas.clientWidth / 2, canvas.clientHeight / 2];
      const meters = metersPerPixel(([x, y]) => {
        const { lat, lng } = map.unproject([x, y]);
        return { lat, lon: lng };
      }, center);
      if (scale.current !== null) {
        scale.current.textContent = `Масштаб ${formatMapScale(scaleDenominator(meters))}`;
      }
      if (mpp.current !== null) mpp.current.textContent = formatMetersPerPixel(meters);
    };
    const onMove = () => {
      frame ??= requestAnimationFrame(showView);
    };
    const onCursor = (event: MapMouseEvent) => {
      if (cursor.current === null) return;
      cursor.current.textContent = formatLatLon(event.lngLat.lat, event.lngLat.lng);
    };
    const onLeave = () => {
      if (cursor.current !== null) cursor.current.textContent = DASH;
    };
    showView();
    map.on('move', onMove);
    map.on('resize', onMove);
    map.on('mousemove', onCursor);
    map.on('mouseout', onLeave);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      map.off('move', onMove);
      map.off('resize', onMove);
      map.off('mousemove', onCursor);
      map.off('mouseout', onLeave);
    };
  }, [map]);

  return (
    <div className={classes.status}>
      <span ref={cursor}>{DASH}</span>
      <span ref={scale} />
      <span ref={mpp} />
    </div>
  );
}

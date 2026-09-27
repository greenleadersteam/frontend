import { Skeleton, Text } from '@mantine/core';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { type JSX, lazy, Suspense, useState } from 'react';

import {
  HATCH_IMAGE,
  hatchPattern,
  MANUAL_IMAGE,
  manualDiamond,
  pixelsPerMeterAtZoom,
  PlanCanvas,
  resultExtent,
  resultLayers,
  resultSources,
  toMapData,
} from '@/entities/project';
import { BASEMAP_BOUNDS } from '@/shared/config';
import { formatMeters } from '@/shared/lib/format';

import type { EditedResult } from '../model/result';
import { LegendSymbol } from './legend-symbol';
import classes from './report-page.module.css';
import { resultLabel } from './result-label';

// Карта грузится лениво, как на экране проекта: MapLibre — тяжёлый чанк.
const MapView = lazy(async () => ({ default: (await import('@/shared/map')).MapView }));

// Поле вписывания участка в снимок: панелей поверх карты нет.
const SNAPSHOT_GAP_PX = 16;

type ReportPlanProps = {
  result: EditedResult;
  editMarks: boolean;
  // План готов к печати: снимок сделан или вместо карты показан запасной план.
  onReady: () => void;
};

// Ширина снимка на листе A4, см: .snapshot печатается ровно на ширину поля листа
// (report-page.module.css), высота — по соотношению сторон карты.
const SHEET_WIDTH_CM = 17;

// Условные знаки под планом — уменьшенные копии слоёв, как в панели «Слои».
const LEGEND = [
  { kind: 'trees', label: 'Деревья' },
  { kind: 'shrubs', label: 'Кустарники' },
  { kind: 'allowed', label: 'Можно сажать' },
  { kind: 'zones', label: 'Зоны запрета' },
  { kind: 'lawn', label: 'Газон' },
  { kind: 'siteBoundary', label: 'Граница участка' },
] as const;

const EDIT_LEGEND = [
  { kind: 'manual', label: 'Добавлена вручную' },
  { kind: 'statusForbidden', label: 'Нарушает норму' },
  { kind: 'statusRejected', label: 'Вне разрешённой области' },
] as const;

// План для печати: отдельная карта со снимком холста в изображение (preserveDrawingBuffer),
// без панелей. Снимок делается, когда карта дорисовала всё (idle). Без WebGL — PlanCanvas.
export function ReportPlan({ result, editMarks, onReady }: ReportPlanProps): JSX.Element {
  const [image, setImage] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [basemapShown, setBasemapShown] = useState(false);
  // Метров на сантиметр листа: снимок растягивается на ширину плана при печати.
  const [metersPerCm, setMetersPerCm] = useState<number | null>(null);
  const { edited, frame, geographic, extent, obstacles, statuses } = result;
  const mapData = toMapData(edited, frame);
  const mapExtent = resultExtent(mapData) ?? extent;
  const bounds = [mapExtent.minX, mapExtent.minY, mapExtent.maxX, mapExtent.maxY] as const;
  const latitude = (bounds[1] + bounds[3]) / 2;
  const [west, south, east, north] = BASEMAP_BOUNDS;
  const withinBasemap =
    geographic &&
    extent.minX >= west &&
    extent.minY >= south &&
    extent.maxX <= east &&
    extent.maxY <= north;

  const draw = (map: MapLibreMap) => {
    const pixelRatio = map.getPixelRatio();
    map.addImage(HATCH_IMAGE, hatchPattern(pixelRatio), { pixelRatio });
    map.addImage(MANUAL_IMAGE, manualDiamond(pixelRatio), { pixelRatio });
    for (const [id, spec] of Object.entries(
      resultSources(mapData, obstacles?.map ?? null, null, statuses, latitude),
    )) {
      map.addSource(id, spec);
    }
    for (const layer of resultLayers(latitude)) map.addLayer(layer);
    // Масштабная линейка и атрибуция — HTML поверх холста, в снимок они не попадают: масштаб и
    // атрибуция идут подписью под планом.
    map.once('idle', () => {
      const widthM = map.getContainer().clientWidth / pixelsPerMeterAtZoom(map.getZoom(), latitude);
      setMetersPerCm(widthM / SHEET_WIDTH_CM);
      setImage(map.getCanvas().toDataURL('image/png'));
      onReady();
    });
  };

  return (
    <figure className={classes.figure}>
      {unavailable ? (
        <div className={classes.plan}>
          <PlanCanvas planting={edited.planting} zones={edited.zones} label={resultLabel(edited)} />
        </div>
      ) : image === null ? (
        <div className={classes.plan}>
          <Suspense fallback={<Skeleton className={classes.fill} />}>
            <MapView
              bounds={[...bounds]}
              padding={{
                top: SNAPSHOT_GAP_PX,
                bottom: SNAPSHOT_GAP_PX,
                left: SNAPSHOT_GAP_PX,
                right: SNAPSHOT_GAP_PX,
              }}
              label={resultLabel(edited)}
              basemap={withinBasemap}
              basemapVisible
              onReady={draw}
              onBasemapResolved={setBasemapShown}
              onUnavailable={() => {
                setUnavailable(true);
                onReady();
              }}
              snapshot
            />
          </Suspense>
        </div>
      ) : (
        <img src={image} alt={resultLabel(edited)} className={classes.snapshot} />
      )}
      <figcaption>
        {metersPerCm !== null && (
          <Text size="xs" className={classes.numbers}>
            {`Масштаб при печати: в 1\u00A0см — ${formatMeters(metersPerCm, 1)}`}
          </Text>
        )}
        {basemapShown && image !== null && (
          <Text size="xs">© участники OpenStreetMap, Protomaps</Text>
        )}
        <ul className={classes.legend} aria-label="Условные знаки плана">
          {[...LEGEND, ...(editMarks ? EDIT_LEGEND : [])].map(({ kind, label }) => (
            <li key={kind} className={classes.legendItem}>
              <LegendSymbol kind={kind} />
              <Text size="xs">{label}</Text>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

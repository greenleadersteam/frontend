import type { Map as MapLibreMap, MapEventType } from 'maplibre-gl';

import type { ImageryConfig } from '@/shared/config';

export const BASEMAP_SOURCE = 'basemap';
export const IMAGERY_SOURCE = 'imagery';
export const IMAGERY_LABELS_SOURCE = 'imagery-labels';
export const IMAGERY_SOURCES = [IMAGERY_SOURCE, IMAGERY_LABELS_SOURCE] as const;

export type BasemapKind = 'scheme' | 'imagery';

export type BasemapOption = {
  kind: BasemapKind;
  title: string;
  // Как назвать источник в сообщении «не загрузилась».
  source: string;
  attribution: string;
  // Источники стиля карты: по их тайлам видно, загрузилась ли подложка.
  sourceIds: readonly string[];
};

export const SCHEME_ATTRIBUTION = '© участники OpenStreetMap, Protomaps';

// Космоснимок: тайлы есть до 19-го масштаба, дальше MapLibre растягивает их до 21-го — ближе
// совмещать контур по снимку нет смысла (как в прототипе ../geojson/js/map.js:38).
export const IMAGERY_NATIVE_ZOOM = 19;
export const IMAGERY_MAX_ZOOM = 21;

// «Схема» — своя подложка, есть всегда; «Снимок» — только если контур его разрешил в конфиге.
export function basemapOptions(imagery: ImageryConfig | null): BasemapOption[] {
  const scheme: BasemapOption = {
    kind: 'scheme',
    title: 'Схема',
    source: 'схема OpenStreetMap',
    attribution: SCHEME_ATTRIBUTION,
    sourceIds: [BASEMAP_SOURCE],
  };
  if (imagery === null) return [scheme];
  return [
    scheme,
    {
      kind: 'imagery',
      title: 'Снимок',
      // Источник снимка задаёт конфиг контура: в сообщении — его сервер, а не зашитое имя.
      source: `космоснимок ${new URL(imagery.tilesUrl).host}`,
      attribution: imagery.attribution,
      sourceIds: IMAGERY_SOURCES,
    },
  ];
}

export type TileCounts = { requested: number; loaded: number; failed: number };
export type BasemapStatus = 'pending' | 'ok' | 'unavailable';

export const BASEMAP_STATUS_DELAY_MS = 3000;

// Подложка работает, если пришёл хоть один тайл: часть тайлов штатно не грузится за краем
// покрытия, и «есть ошибка» не значит «не работает». Недоступна — если за три секунды после
// переключения не пришло ни одного. Скрытая подложка ничего не запрашивает — это не тревога.
export function basemapStatus(counts: TileCounts, elapsedMs: number): BasemapStatus {
  if (counts.loaded > 0) return 'ok';
  if (elapsedMs >= BASEMAP_STATUS_DELAY_MS && (counts.requested > 0 || counts.failed > 0)) {
    return 'unavailable';
  }
  return 'pending';
}

// Следит за тайлами источников подложки с момента вызова и один раз сообщает итог: 'ok' по
// первому тайлу или 'unavailable' через три секунды без единого. Возвращает отписку.
export function watchBasemap(
  map: MapLibreMap,
  sourceIds: readonly string[],
  onStatus: (status: Exclude<BasemapStatus, 'pending'>) => void,
): () => void {
  const counts: TileCounts = { requested: 0, loaded: 0, failed: 0 };
  const started = performance.now();
  let settled = false;

  const settle = (status: BasemapStatus) => {
    if (settled || status === 'pending') return;
    settled = true;
    stop();
    onStatus(status);
  };
  const ours = (sourceId: unknown) => typeof sourceId === 'string' && sourceIds.includes(sourceId);
  const onLoading = (event: MapEventType['dataloading']) => {
    if (event.dataType === 'source' && event.tile !== undefined && ours(event.sourceId)) {
      counts.requested += 1;
    }
  };
  const onData = (event: MapEventType['sourcedata']) => {
    if (event.tile === undefined || !ours(event.sourceId)) return;
    counts.loaded += 1;
    settle(basemapStatus(counts, performance.now() - started));
  };
  // Ошибка тайла приходит с sourceId и tile; у ErrorEvent в типах MapLibre их нет.
  const onError = (event: MapEventType['error']) => {
    if ('tile' in event && 'sourceId' in event && ours(event.sourceId)) counts.failed += 1;
  };
  const timer = setTimeout(() => {
    settle(basemapStatus(counts, performance.now() - started));
  }, BASEMAP_STATUS_DELAY_MS);

  function stop() {
    clearTimeout(timer);
    map.off('dataloading', onLoading);
    map.off('sourcedata', onData);
    map.off('error', onError);
  }
  map.on('dataloading', onLoading);
  map.on('sourcedata', onData);
  map.on('error', onError);
  return stop;
}

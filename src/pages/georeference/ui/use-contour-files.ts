import { notifications } from '@mantine/notifications';
import { useState } from 'react';

import {
  findSameReference,
  georeferenceActions,
  selectGeoreference,
} from '@/entities/georeference';
import {
  buildContour,
  buildReference,
  EXAMPLE_CONTOUR_NAME,
  EXAMPLE_CONTOUR_TEXT,
  PARSE_ERROR_TEXT,
  readGeoJson,
  REFERENCE_ERROR_TEXT,
} from '@/shared/lib/contour';
import type { LatLon } from '@/shared/lib/geodesy';
import type { Placement } from '@/shared/lib/georeference';
import { useAppDispatch, useAppSelector } from '@/shared/lib/store';

// Собственная выгрузка модуля: её координаты — градусы, контуром она не откроется, но может
// стать эталоном.
export type PendingReference = { fileName: string; value: unknown; created: string | null };

type ContourFilesOptions = {
  // false — контур уже задан (граница участка проекта): файлы открываются только эталонами.
  contourAllowed: boolean;
  // Куда поставить опорную точку нового контура — центр карты.
  anchor: () => LatLon | null;
  // Положение нового контура: опорная точка в центре карты, без поворота, масштаб 1.
  onLoaded: (placement: Placement) => void;
};

type SourceFile = { name: string; text: () => Promise<string> };

// Открытие файлов: кнопкой, перетаскиванием и примером. Файлов может быть несколько: первый
// с полигонами становится контуром, собственные выгрузки предлагаются эталонами.
export function useContourFiles({ contourAllowed, anchor, onLoaded }: ContourFilesOptions) {
  const dispatch = useAppDispatch();
  const session = useAppSelector(selectGeoreference);
  const [pending, setPending] = useState<PendingReference[]>([]);

  const open = async (files: readonly SourceFile[]) => {
    const at = anchor();
    if (at === null) {
      // Файл бросили в окно, пока карта грузится или если её нет вовсе.
      notifications.show({
        color: 'clay',
        message:
          'Карта ещё не готова: контур некуда поставить. Откройте файл, когда она загрузится.',
      });
      return;
    }
    let loaded: Placement | null = null;
    const references: PendingReference[] = [];
    for (const file of files) {
      let text: string;
      try {
        text = await file.text();
      } catch {
        notifications.show({
          color: 'clay',
          message: `Файл «${file.name}» не прочитан. Выберите его снова.`,
        });
        continue;
      }
      const read = readGeoJson(text);
      if (!read.ok) {
        notifications.show({
          color: 'clay',
          message: `Файл «${file.name}» не открыт. ${PARSE_ERROR_TEXT[read.error.kind]}`,
        });
        continue;
      }
      if (read.result !== null) {
        references.push({ fileName: file.name, value: read.value, created: read.result.created });
        continue;
      }
      if (!contourAllowed) {
        notifications.show({
          message: `Файл «${file.name}» не открыт: контур здесь — граница участка проекта. Эталоном открывается только выгрузка привязки.`,
        });
        continue;
      }
      const parsed = buildContour(read.value, file.name);
      if (!parsed.ok) {
        notifications.show({
          color: 'clay',
          message: `Файл «${file.name}» не открыт. ${PARSE_ERROR_TEXT[parsed.error.kind]}`,
        });
        continue;
      }
      if (loaded !== null) {
        notifications.show({
          message: `Файл «${file.name}» не открыт: контур уже взят из «${loaded.source.name}». Контур на карте один.`,
        });
        continue;
      }
      loaded = { source: parsed.contour, anchor: at, rotation: 0, scale: 1 };
      dispatch(georeferenceActions.contourLoaded({ contour: parsed.contour, anchor: at }));
    }
    if (loaded !== null) onLoaded(loaded);
    if (references.length > 0) setPending((queue) => [...queue, ...references]);
  };

  const openExample = () =>
    open([{ name: EXAMPLE_CONTOUR_NAME, text: () => Promise.resolve(EXAMPLE_CONTOUR_TEXT) }]);

  const answer = (asReference: boolean) => {
    const [first] = pending;
    setPending((queue) => queue.slice(1));
    if (first === undefined || !asReference) return;
    const built = buildReference(first.value, first.fileName);
    if (!built.ok) {
      notifications.show({ color: 'clay', message: REFERENCE_ERROR_TEXT[built.error.kind] });
      return;
    }
    // JSON и geojson одной выгрузки — один и тот же эталон: второй раз он не добавляется.
    const same = findSameReference(session, built.reference);
    if (same !== null) {
      notifications.show({ message: `Этот эталон уже открыт: «${same.name}».` });
      return;
    }
    dispatch(georeferenceActions.referenceAdded({ reference: built.reference }));
  };

  return { open, openExample, pendingReference: pending[0] ?? null, answer };
}

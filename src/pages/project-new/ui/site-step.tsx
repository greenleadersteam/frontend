import {
  Alert,
  Button,
  Group,
  NumberInput,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
} from '@mantine/core';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { type JSX, lazy, Suspense, useId, useState } from 'react';

import { formatNumber } from '@/shared/lib/format';

import { type SiteArea, siteProblem, siteSize } from '../model/site';
import classes from './site-step.module.css';

// maplibre-gl и стиль подложки грузятся, только когда шаг показывается.
const MapView = lazy(async () => ({ default: (await import('@/shared/map')).MapView }));

// Рамка — 70 % меньшей стороны карты; то же число в site-step.module.css (70cqmin).
const FRAME_SHARE = 0.7;
// Центр Москвы: с него пользователь приближает карту к своему участку.
const START: [number, number, number, number] = [37.56, 55.73, 37.68, 55.77];
const NO_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };

const NO_BASEMAP =
  'Подложка не загружена: выбрать область на карте нельзя. Введите координаты углов участка.';
const NO_MAP =
  'Карта недоступна в этом браузере: выбрать область на ней нельзя. Введите координаты углов участка.';

type SiteStepProps = {
  initial: SiteArea | null;
  onBack: () => void;
  onSubmit: (site: SiteArea) => void;
};

// Сервер без optionalBbox требует bbox_user: по нему геопривязка отличает геодезические пункты
// с одинаковыми номерами (../backend/greenplan/api/schemas.py:13-18).
// Карта вписывает прежнюю область с запасом: рамка — 70 % меньшей стороны, и без расширения
// в 1 / FRAME_SHARE раза область сжималась бы на 30 % при каждом возврате на шаг.
function framed({ west, south, east, north }: SiteArea): [number, number, number, number] {
  const grow = (1 / FRAME_SHARE - 1) / 2;
  const width = east - west;
  const height = north - south;
  return [west - width * grow, south - height * grow, east + width * grow, north + height * grow];
}

export function SiteStep({ initial, onBack, onSubmit }: SiteStepProps): JSX.Element {
  const problemId = useId();
  const [input, setInput] = useState<'map' | 'no-basemap' | 'no-map'>('map');
  // Ошибку ручного ввода показываем после ухода из поля или попытки перейти дальше, а не на
  // каждую набранную цифру.
  const [touched, setTouched] = useState(false);
  const [mapArea, setMapArea] = useState<SiteArea | null>(null);
  const [corners, setCorners] = useState<Record<keyof SiteArea, number | string>>(
    initial ?? { west: '', south: '', east: '', north: '' },
  );

  const { west, south, east, north } = corners;
  // NumberInput отдаёт '' для пустого поля: область есть, когда заполнены все четыре угла.
  const manualArea =
    typeof west === 'number' &&
    typeof south === 'number' &&
    typeof east === 'number' &&
    typeof north === 'number'
      ? { west, south, east, north }
      : null;
  const area = input === 'map' ? mapArea : manualArea;
  const problem = area === null ? null : siteProblem(area, input === 'map' ? 'map' : 'manual');
  const shownProblem = input === 'map' || touched ? problem : null;
  const size = area === null ? null : siteSize(area);

  // Рамка неподвижна, двигается карта: область — углы рамки, пересчитанные при каждом движении.
  const track = (map: MapLibreMap) => {
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = map.getContainer();
      const side = FRAME_SHARE * Math.min(width, height);
      const southWest = map.unproject([(width - side) / 2, (height + side) / 2]);
      const northEast = map.unproject([(width + side) / 2, (height - side) / 2]);
      setMapArea({
        west: southWest.lng,
        south: southWest.lat,
        east: northEast.lng,
        north: northEast.lat,
      });
    };
    map.on('move', measure);
    map.on('resize', measure);
    measure();
  };

  const corner = (key: keyof SiteArea, label: string) => (
    <NumberInput
      label={label}
      value={corners[key]}
      onChange={(value) => {
        setCorners((previous) => ({ ...previous, [key]: value }));
      }}
      onBlur={() => {
        setTouched(true);
      }}
      decimalSeparator=","
      decimalScale={6}
      hideControls
    />
  );

  return (
    <Stack gap="lg">
      {input === 'map' ? (
        <Stack gap="xs">
          <div className={classes.map}>
            <Suspense fallback={<Skeleton className={classes.fill} radius="xl" />}>
              <MapView
                bounds={initial === null ? START : framed(initial)}
                padding={NO_PADDING}
                label="Карта для выбора области участка"
                basemap
                basemapVisible
                basemapSwitch
                onReady={track}
                onBasemapResolved={(available) => {
                  if (!available) setInput('no-basemap');
                }}
                onUnavailable={() => {
                  setInput('no-map');
                }}
              >
                <div className={classes.viewport} aria-hidden>
                  <div className={classes.frame}>
                    <span className={classes.corner} data-corner="nw" />
                    <span className={classes.corner} data-corner="ne" />
                    <span className={classes.corner} data-corner="sw" />
                    <span className={classes.corner} data-corner="se" />
                  </div>
                </div>
              </MapView>
            </Suspense>
          </div>
          <Text size="sm" c="dimmed">
            Приблизьте карту к участку. Сервис найдёт на чертеже точки геодезической сети в этой
            области.
          </Text>
        </Stack>
      ) : (
        <Stack gap="md">
          <Alert color="stone" variant="light">
            <Text size="sm">{input === 'no-basemap' ? NO_BASEMAP : NO_MAP}</Text>
          </Alert>
          <SimpleGrid cols={2}>
            {corner('south', 'Широта юго-западного угла')}
            {corner('west', 'Долгота юго-западного угла')}
            {corner('north', 'Широта северо-восточного угла')}
            {corner('east', 'Долгота северо-восточного угла')}
          </SimpleGrid>
        </Stack>
      )}

      {size !== null && (input === 'map' || problem === null) && (
        <Text className={classes.size}>
          {`Область: ${formatNumber(Math.round(size.width))} × ${formatNumber(Math.round(size.height))}\u00A0м`}
        </Text>
      )}

      {/* Текст меняется при движении карты и наборе координат: объявляется вежливо, а кнопку
          он описывает через aria-describedby. */}
      <Text id={problemId} size="sm" className={classes.error} aria-live="polite">
        {shownProblem}
      </Text>

      <Group justify="space-between">
        <Button variant="default" onClick={onBack}>
          Назад
        </Button>
        <Button
          disabled={area === null || (problem !== null && (input === 'map' || touched))}
          aria-describedby={shownProblem === null ? undefined : problemId}
          onClick={() => {
            setTouched(true);
            if (area !== null && problem === null) onSubmit(area);
          }}
        >
          Далее: файлы
        </Button>
      </Group>
    </Stack>
  );
}

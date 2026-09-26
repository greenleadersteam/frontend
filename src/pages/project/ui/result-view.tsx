import { Alert, Button, Skeleton, Stack, Text } from '@mantine/core';
import { type JSX, useState } from 'react';

import {
  isGeographic,
  PlanCanvas,
  type PlantingFeatureCollection,
  type Project,
  resultExtent,
  useGetPlantingQuery,
  useGetZonesQuery,
  type ZonesFeatureCollection,
} from '@/entities/project';
import { describeAppError, toAppError } from '@/shared/api';
import { BASEMAP_BOUNDS } from '@/shared/config';

import { resultLabel } from './result-label';
import { ResultMap } from './result-map';
import classes from './result-view.module.css';

type ResultViewProps = { project: Project };

export function ResultView({ project }: ResultViewProps): JSX.Element {
  const planting = useGetPlantingQuery(project.id);
  const zones = useGetZonesQuery(project.id);
  const [mapUnavailable, setMapUnavailable] = useState(false);

  const error = planting.error ?? zones.error;
  if (error !== undefined) {
    return (
      <Stack gap="md" align="flex-start" justify="center" className={classes.area}>
        <Text role="alert">{describeAppError(toAppError(error))}</Text>
        <Button
          variant="default"
          loading={planting.isFetching || zones.isFetching}
          onClick={() => {
            if (planting.isError) void planting.refetch();
            if (zones.isError) void zones.refetch();
          }}
        >
          Повторить
        </Button>
      </Stack>
    );
  }
  if (planting.data === undefined || zones.data === undefined) {
    return (
      <Skeleton
        className={classes.area}
        radius="xl"
        role="status"
        aria-busy="true"
        aria-label="Загрузка плана посадок"
      />
    );
  }

  // Без геопривязки бэкенд отдаёт координаты чертежа с меткой CRS
  // (../backend/greenplan/export/geojson.py:18): на подложку их не положить. Метка берётся
  // из /zones: задеплоенный бэкенд пока не отдаёт metadata в /planting.
  if (!isGeographic(zones.data.metadata.crs)) {
    return (
      <FallbackPlan
        planting={planting.data}
        zones={zones.data}
        message="У проекта нет геопривязки. Показан план посадок в координатах чертежа"
      />
    );
  }
  const extent = resultExtent({ planting: planting.data, zones: zones.data });
  const [west, south, east, north] = BASEMAP_BOUNDS;
  if (
    extent !== null &&
    (extent.minX < west || extent.minY < south || extent.maxX > east || extent.maxY > north)
  ) {
    return (
      <FallbackPlan
        planting={planting.data}
        zones={zones.data}
        message="Участок за пределами карты Москвы. Показан план посадок без подложки"
      />
    );
  }
  if (mapUnavailable) {
    return (
      <FallbackPlan
        planting={planting.data}
        zones={zones.data}
        message="Карта недоступна в этом браузере. Показан план посадок без подложки"
      />
    );
  }
  return (
    <ResultMap
      planting={planting.data}
      zones={zones.data}
      onUnavailable={() => {
        setMapUnavailable(true);
      }}
    />
  );
}

type FallbackPlanProps = {
  planting: PlantingFeatureCollection;
  zones: ZonesFeatureCollection;
  message: string;
};

// Запасной вид — план из превью, крупно, без подложки и без выбора посадки.
function FallbackPlan({ planting, zones, message }: FallbackPlanProps): JSX.Element {
  return (
    <Stack gap="md" className={classes.fallback}>
      <Alert color="stone" variant="light">
        <Text size="sm">{message}</Text>
      </Alert>
      <div className={classes.area} data-plan>
        <PlanCanvas planting={planting} zones={zones} label={resultLabel({ planting, zones })} />
      </div>
    </Stack>
  );
}

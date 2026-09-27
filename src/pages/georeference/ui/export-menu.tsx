import { Button, Group, Menu, SegmentedControl, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconChevronDown, IconCopy } from '@tabler/icons-react';
import { type JSX, useState } from 'react';
import { z } from 'zod';

import {
  buildExport,
  type CsvOptions,
  EXPORT_ERROR_TEXT,
  exportFileName,
  type ExportFormat,
  type ExportResult,
  toCsv,
  toGeoJson,
  toJson,
} from '@/entities/georeference';
import type { GcpPair, Placement, WorkScale } from '@/shared/lib/georeference';
import { saveFile } from '@/shared/lib/save-file';
import { Icon } from '@/shared/ui';

const CSV_STORAGE_KEY = 'georeference.csv';
const csvOptionsSchema = z.object({ delimiter: z.enum([';', ',']), decimal: z.enum([',', '.']) });
type CsvChoice = z.infer<typeof csvOptionsSchema>;
const DEFAULT_CSV: CsvChoice = { delimiter: ';', decimal: ',' };

// Настройки CSV запоминаются в браузере: это удобство, а не данные. Хранилище может быть
// недоступно (приватный режим, запрет) — тогда просто умолчания.
function readCsvChoice(): CsvChoice {
  try {
    // eslint-disable-next-line no-restricted-globals -- настройки CSV, не токен и не данные
    const stored = localStorage.getItem(CSV_STORAGE_KEY);
    if (stored === null) return DEFAULT_CSV;
    const parsed = csvOptionsSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : DEFAULT_CSV;
  } catch {
    return DEFAULT_CSV;
  }
}

function writeCsvChoice(choice: CsvChoice): void {
  try {
    // eslint-disable-next-line no-restricted-globals -- настройки CSV, не токен и не данные
    localStorage.setItem(CSV_STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // Не запомнилось — в следующий раз будут умолчания; выгрузка от этого не зависит.
  }
}

const MIME: Record<ExportFormat, string> = {
  json: 'application/json',
  csv: 'text/csv',
  geojson: 'application/geo+json',
};

type ExportMenuProps = {
  placement: Placement | null;
  gcp: readonly GcpPair[];
  workScale: WorkScale;
};

export function ExportMenu({ placement, gcp, workScale }: ExportMenuProps): JSX.Element {
  const [csv, setCsv] = useState(readCsvChoice);

  const chooseCsv = (choice: Partial<CsvChoice>) => {
    const next = { ...csv, ...choice };
    setCsv(next);
    writeCsvChoice(next);
  };

  // Самопроверка замыкания круга — внутри каждого формата: без неё файла нет.
  const reportFailure = (
    result: ExportResult<unknown>,
  ): result is Extract<typeof result, { ok: false }> => {
    if (result.ok) return false;
    notifications.show({ color: 'clay', message: EXPORT_ERROR_TEXT[result.error.kind] });
    return true;
  };

  const download = (format: ExportFormat) => {
    if (placement === null) return;
    const state = { ...placement, gcp, workScale };
    const date = new Date();
    const options: CsvOptions = csv;
    const result =
      format === 'json'
        ? toJson(state, date)
        : format === 'csv'
          ? toCsv(state, options, date)
          : toGeoJson(state, date);
    if (reportFailure(result)) return;
    saveFile(
      new Blob([result.value], { type: `${MIME[format]};charset=utf-8` }),
      exportFileName(placement.source.name, format),
    );
  };

  const copyGcp = async () => {
    if (placement === null) return;
    const result = buildExport({ ...placement, gcp, workScale }, new Date());
    if (reportFailure(result)) return;
    try {
      await navigator.clipboard.writeText(result.value.gcp_gdal_translate);
      notifications.show({ message: 'Строка GCP для gdal_translate скопирована' });
    } catch {
      notifications.show({
        color: 'clay',
        message:
          'Не удалось скопировать строку GCP. Она есть в выгрузке JSON — возьмите её оттуда.',
      });
    }
  };

  const disabled = placement === null;

  return (
    <Stack gap="xs">
      <Menu position="bottom-start" closeOnItemClick>
        <Menu.Target>
          <Button disabled={disabled} rightSection={<Icon icon={IconChevronDown} />}>
            Выгрузить
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            onClick={() => {
              download('json');
            }}
          >
            JSON — параметры и каталог
          </Menu.Item>
          <Menu.Item
            onClick={() => {
              download('csv');
            }}
          >
            CSV — каталог координат
          </Menu.Item>
          <Menu.Item
            onClick={() => {
              download('geojson');
            }}
          >
            GeoJSON — контур в WGS84
          </Menu.Item>
          <Menu.Divider />
          <Stack gap="xs" p="xs">
            <Text size="xs" c="dimmed" id="csv-delimiter-label">
              CSV: разделитель столбцов
            </Text>
            <SegmentedControl
              size="xs"
              aria-labelledby="csv-delimiter-label"
              value={csv.delimiter}
              onChange={(value) => {
                chooseCsv({ delimiter: value === ',' ? ',' : ';' });
              }}
              data={[
                { value: ';', label: 'точка с запятой' },
                { value: ',', label: 'запятая' },
              ]}
            />
            <Text size="xs" c="dimmed" id="csv-decimal-label">
              CSV: десятичный знак
            </Text>
            <SegmentedControl
              size="xs"
              aria-labelledby="csv-decimal-label"
              value={csv.decimal}
              onChange={(value) => {
                chooseCsv({ decimal: value === '.' ? '.' : ',' });
              }}
              data={[
                { value: ',', label: 'запятая' },
                { value: '.', label: 'точка' },
              ]}
            />
            {csv.delimiter === ',' && csv.decimal === ',' && (
              <Text size="xs" c="dimmed">
                Запятая не может быть сразу разделителем и десятичным знаком: столбцы разделит точка
                с запятой.
              </Text>
            )}
          </Stack>
        </Menu.Dropdown>
      </Menu>
      <Group>
        <Button
          variant="subtle"
          disabled={disabled}
          leftSection={<Icon icon={IconCopy} />}
          onClick={() => void copyGcp()}
        >
          Скопировать строку GCP
        </Button>
      </Group>
    </Stack>
  );
}

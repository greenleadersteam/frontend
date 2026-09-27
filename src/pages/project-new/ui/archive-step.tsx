import { Alert, Button, Card, Group, List, Stack, Text } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { IconFiles } from '@tabler/icons-react';
import { type JSX, useState } from 'react';

import { MAX_ARCHIVE_BYTES } from '@/shared/api';
import { formatCount, formatFileSize } from '@/shared/lib/format';

import { type CheckedArchive, checkSelection, dxfEntriesOf } from '../model/check-archive';
import classes from './archive-step.module.css';

const FILE_FORMS = { one: 'файл', few: 'файла', many: 'файлов' };

type ArchiveStepProps = {
  archive: CheckedArchive | null;
  notice: string | null;
  // Для проекта, открытого из списка, назад идти некуда: описание уже есть.
  onBack: (() => void) | null;
  onChecked: (archive: CheckedArchive) => void;
  onCleared: () => void;
  onUpload: () => void;
};

export function ArchiveStep({
  archive,
  notice,
  onBack,
  onChecked,
  onCleared,
  onUpload,
}: ArchiveStepProps): JSX.Element {
  const [rejection, setRejection] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const check = async (files: File[]) => {
    setChecking(true);
    // Файл мог стать недоступным после выбора (сетевой диск, файл изменён): чтение бросает.
    const result = await checkSelection(files).catch(() => ({
      kind: 'rejected' as const,
      message: 'Не удалось прочитать файл. Выберите его снова.',
    }));
    setChecking(false);
    if (result.kind === 'rejected') {
      setRejection(result.message);
      return;
    }
    setRejection(null);
    onChecked(result.archive);
  };

  return (
    <Stack gap="lg">
      {notice !== null && (
        <Alert color="clay" variant="light">
          {notice}
        </Alert>
      )}

      {archive === null ? (
        <Stack gap="xs">
          <Dropzone
            loading={checking}
            onDrop={(files) => void check(files)}
            className={classes.dropzone}
            aria-describedby={rejection === null ? undefined : 'archive-rejection'}
          >
            <Stack gap="sm" align="center" className={classes.dropzoneInner}>
              <span className={classes.plate}>
                <IconFiles size={24} stroke={1.5} aria-hidden className={classes.icon} />
              </span>
              <Text className={classes.strong}>
                Перетащите ZIP, один или несколько DXF и связанные файлы
              </Text>
              <Text size="sm" c="dimmed">
                {`До ${formatFileSize(MAX_ARCHIVE_BYTES)}. Сервер читает только DXF: главный чертёж генплана и его внешние ссылки (xref).`}
              </Text>
            </Stack>
          </Dropzone>
          {rejection !== null && (
            <Text id="archive-rejection" size="sm" className={classes.error} role="alert">
              {rejection}
            </Text>
          )}
        </Stack>
      ) : (
        <ArchiveSummary archive={archive} onReplace={onCleared} />
      )}

      <Group justify="space-between">
        {onBack === null ? (
          <span />
        ) : (
          <Button variant="default" onClick={onBack}>
            Назад
          </Button>
        )}
        <Button disabled={archive === null} onClick={onUpload}>
          Загрузить и обработать
        </Button>
      </Group>
    </Stack>
  );
}

type ArchiveSummaryProps = {
  archive: CheckedArchive;
  onReplace: () => void;
};

// Имена файлов из архива — недоверенные данные: выводятся только текстом.
function ArchiveSummary({ archive, onReplace }: ArchiveSummaryProps): JSX.Element {
  const [showAll, setShowAll] = useState(false);
  const { file, packed, entries } = archive;
  const indexed = entries?.map((entry, index) => ({ ...entry, index })) ?? null;
  const files = indexed?.filter(({ isDirectory }) => !isDirectory) ?? null;
  const dxf = indexed === null ? [] : dxfEntriesOf(indexed);

  return (
    <Card>
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap="xs" className={classes.summaryTitle}>
            <Text className={classes.fileName}>{packed ? 'Выбранные файлы' : file.name}</Text>
            <Text size="sm" c="dimmed">
              {files === null
                ? formatFileSize(file.size)
                : `${formatFileSize(file.size)}, ${formatCount(files.length, FILE_FORMS)}`}
            </Text>
          </Stack>
          <Button variant="subtle" onClick={onReplace}>
            {packed ? 'Заменить файлы' : 'Заменить архив'}
          </Button>
        </Group>

        {files === null ? (
          <Text size="sm">
            Не удалось прочитать список файлов в архиве. Архив проверит сервер после загрузки.
          </Text>
        ) : (
          <>
            <Stack gap="xs">
              <Text size="sm" className={classes.strong}>
                Чертежи DXF
              </Text>
              <List spacing="xs" listStyleType="none" className={classes.paths}>
                {/* Ключ — позиция в каталоге: ZIP допускает две записи с одним именем. */}
                {dxf.map(({ path, index }) => (
                  <List.Item key={index}>
                    <Text size="sm" c="dimmed">
                      {path}
                    </Text>
                  </List.Item>
                ))}
              </List>
              {dxf.length > 1 && (
                <Text size="sm">
                  Сервис сам определит главный чертёж. Если не сможет — попросит выбрать.
                </Text>
              )}
            </Stack>
            <div>
              <Button
                variant="subtle"
                size="compact-sm"
                aria-expanded={showAll}
                onClick={() => {
                  setShowAll((shown) => !shown);
                }}
              >
                {showAll ? 'Скрыть файлы' : `Показать все файлы (${String(files.length)})`}
              </Button>
              {showAll && (
                <List spacing="xs" listStyleType="none" className={classes.paths}>
                  {files.map(({ path, index }) => (
                    <List.Item key={index}>
                      <Text size="sm" c="dimmed">
                        {path}
                      </Text>
                    </List.Item>
                  ))}
                </List>
              )}
            </div>
          </>
        )}
      </Stack>
    </Card>
  );
}

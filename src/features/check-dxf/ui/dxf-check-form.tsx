import {
  Alert,
  Button,
  FileInput,
  Group,
  Progress,
  Stack,
  Table,
  Text,
  Title,
  VisuallyHidden,
} from '@mantine/core';
import { type JSX, type Ref, useEffect, useRef, useState } from 'react';

import { fetchProjectDxf, type Project, projectFileName } from '@/entities/project';
import { compareDxfFiles, type LayerStatus } from '@/shared/lib/dxf-compare';
import { formatDateTime, formatNumber, formatPercent } from '@/shared/lib/format';
import { saveFile } from '@/shared/lib/save-file';
import { useAppDispatch, useAppSelector } from '@/shared/lib/store';

import {
  checked,
  type DxfCheck,
  dxfProtocol,
  dxfVerdict,
  selectDxfCheck,
} from '../model/dxf-check';
import classes from './dxf-check-form.module.css';
import { DxfCheckLines } from './dxf-check-lines';

type Run =
  | { kind: 'idle' }
  | { kind: 'downloading' }
  | { kind: 'comparing'; progress: number }
  | { kind: 'error'; message: string };

type DxfCheckFormProps = {
  project: Project;
  // Версия плана посадок, чей DXF проверяется; null — сервер без версий, /dxf.
  version: number | null;
  // Почему проверять пока нельзя: список версий грузится или не загрузился.
  blocked: string | null;
};

const versionFile = (version: number | null) =>
  version === null ? '.dxf' : ` — версия ${String(version)}.dxf`;

// Исходный чертёж пользователя против DXF сервиса: скачивание, сравнение в воркере, отмена.
export function DxfCheckForm({ project, version, blocked }: DxfCheckFormProps): JSX.Element {
  const dispatch = useAppDispatch();
  const check = useAppSelector((state) => selectDxfCheck(state, project.id));
  const [source, setSource] = useState<File | null>(null);
  const [run, setRun] = useState<Run>({ kind: 'idle' });
  const controller = useRef<AbortController | null>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  const busy = run.kind === 'downloading' || run.kind === 'comparing';
  const hint = blocked ?? (source === null ? 'Выберите исходный чертёж' : null);

  const start = async () => {
    if (source === null) return;
    const signal = (controller.current = new AbortController()).signal;
    setRun({ kind: 'downloading' });
    const server = await fetchProjectDxf(project.id, version, { signal });
    if (server.kind === 'aborted') return;
    if (server.kind === 'error') {
      setRun({ kind: 'error', message: server.message });
      return;
    }
    setRun({ kind: 'comparing', progress: 0 });
    try {
      const comparison = await compareDxfFiles(source, server.file, {
        signal,
        onProgress: (progress) => {
          setRun({ kind: 'comparing', progress });
        },
      });
      if (comparison === null) return;
      dispatch(
        checked({
          projectId: project.id,
          check: {
            checkedAt: new Date().toISOString(),
            source: { name: source.name, size: source.size },
            result: {
              name: projectFileName(project.name, versionFile(version)),
              size: server.file.size,
            },
            version,
            comparison,
          },
        }),
      );
      setRun({ kind: 'idle' });
      // Кнопка «Отменить» исчезла вместе с фокусом: он переходит к итогу.
      requestAnimationFrame(() => {
        resultRef.current?.focus();
      });
    } catch {
      setRun({
        kind: 'error',
        message: 'Браузер не смог сравнить файлы. Обновите страницу и повторите проверку.',
      });
    }
  };

  const cancel = () => {
    controller.current?.abort();
    setRun({ kind: 'idle' });
    // Пока шла проверка, кнопка была в загрузке и недоступна: фокус — после перерисовки.
    requestAnimationFrame(() => {
      startRef.current?.focus();
    });
  };

  return (
    <Stack gap="lg">
      <Text className={classes.lead}>
        Сравнивает исходный чертёж с результатом сервиса по слоям: число сущностей и содержимое
        каждой. Handle, владелец, $HANDSEED и даты сохранения не сравниваются: их переписывает любое
        сохранение файла. Файлы остаются в браузере.
      </Text>
      <FileInput
        className={classes.field}
        label="Исходный чертёж"
        description="Главный чертёж из архива, который загружали в проект, — файл DXF"
        placeholder="Выберите файл"
        accept=".dxf"
        value={source}
        disabled={busy}
        onChange={setSource}
        clearable
      />
      <Text size="sm" c="dimmed">
        {version === null
          ? 'Результат — DXF сервиса с сервера.'
          : `Результат — DXF версии ${String(version)} плана посадок с сервера.`}
      </Text>
      <Group>
        <Button
          ref={startRef}
          loading={busy}
          disabled={source === null || blocked !== null}
          onClick={() => void start()}
        >
          Проверить
        </Button>
        {busy && (
          <Button variant="default" onClick={cancel}>
            Отменить
          </Button>
        )}
        {!busy && hint !== null && (
          <Text size="sm" c="dimmed">
            {hint}
          </Text>
        )}
      </Group>
      {busy && <RunProgress run={run} />}
      {run.kind === 'error' && (
        <Alert color="clay" variant="light" role="alert">
          {run.message}
        </Alert>
      )}
      {check !== null && (
        <DxfCheckResult project={project} check={check} version={version} titleRef={resultRef} />
      )}
    </Stack>
  );
}

type RunProgressProps = { run: Run };

// Процент на экране — на каждом шаге воркера, скринридеру — только этап и шаг в 10 %.
function RunProgress({ run }: RunProgressProps): JSX.Element {
  const progress = run.kind === 'comparing' ? run.progress : 0;
  const label =
    run.kind === 'downloading'
      ? 'Загрузка результата с сервера'
      : `Сравнение: ${formatPercent(progress)}`;
  return (
    <Stack gap="xs" className={classes.field}>
      <Text size="sm" aria-hidden>
        {label}
      </Text>
      <VisuallyHidden aria-live="polite">
        {run.kind === 'downloading'
          ? label
          : `Сравнение: ${formatPercent(Math.floor(progress * 10) / 10)}`}
      </VisuallyHidden>
      <Progress value={progress * 100} aria-hidden />
    </Stack>
  );
}

const STATUS_LABELS: Record<LayerStatus, string> = {
  same: 'Совпадает',
  changed: 'Изменён',
  added: 'Добавлен',
  removed: 'Удалён',
};

type DxfCheckResultProps = {
  project: Project;
  check: DxfCheck;
  version: number | null;
  titleRef: Ref<HTMLHeadingElement>;
};

function DxfCheckResult({ project, check, version, titleRef }: DxfCheckResultProps): JSX.Element {
  const { comparison } = check;
  const verdict = dxfVerdict(comparison);
  return (
    <Stack gap="md" component="section" aria-labelledby="dxf-check-result">
      <Title order={2} id="dxf-check-result" ref={titleRef} tabIndex={-1}>
        Результат проверки
      </Title>
      {version !== null && check.version !== version && (
        <Alert color="ochre" variant="light">
          {`Проверена версия ${String(check.version)}, а выбрана ${String(version)}. Проверьте выбранную версию снова.`}
        </Alert>
      )}
      <Alert color={verdict.kind === 'unchanged' ? 'sage' : 'clay'} variant="light">
        <Text fw={600}>{verdict.text}</Text>
      </Alert>
      <DxfCheckLines check={check} />
      <Text size="sm" c="dimmed">
        {`Исходный чертёж: ${check.source.name}. Результат: ${check.result.name}. Проверено ${formatDateTime(check.checkedAt)}.`}
      </Text>
      {comparison.kind === 'compared' && (
        <Table className={classes.table}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Слой</Table.Th>
              <Table.Th className={classes.number}>В исходном</Table.Th>
              <Table.Th className={classes.number}>В результате</Table.Th>
              <Table.Th>Итог</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {comparison.layers.map((layer) => (
              <Table.Tr key={layer.name}>
                <Table.Td>{layer.name}</Table.Td>
                <Table.Td className={classes.number}>{formatNumber(layer.source)}</Table.Td>
                <Table.Td className={classes.number}>{formatNumber(layer.result)}</Table.Td>
                <Table.Td>{STATUS_LABELS[layer.status]}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Group>
        <Button
          variant="default"
          onClick={() => {
            saveFile(
              new Blob([dxfProtocol(project, check)], { type: 'application/json' }),
              projectFileName(project.name, ' — проверка чертежа.json'),
            );
          }}
        >
          Скачать протокол (JSON)
        </Button>
      </Group>
    </Stack>
  );
}

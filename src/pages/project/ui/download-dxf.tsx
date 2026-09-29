import { Button, Menu, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconChevronDown } from '@tabler/icons-react';
import { type JSX, useState } from 'react';

import {
  downloadProjectDxf,
  type DxfVersion,
  fetchProjectDxf,
  type Project,
  projectFileName,
} from '@/entities/project';
import { usePlantingEdits, usePlantingVersions } from '@/features/edit-plantings';
import { describeAppError } from '@/shared/api';
import { useCapability } from '@/shared/config';
import { formatMeters } from '@/shared/lib/format';
import { saveFile } from '@/shared/lib/save-file';

import { type EditedDrawing, editedDrawing, type EditedDxf, editedDxf } from '../model/edited-dxf';
import { editedResult, type LoadedResult, resultBase, useResultData } from '../model/result';
import classes from './project-header.module.css';

type DownloadDxfProps = { project: Project };

const useDownload = (project: Project) => {
  const [loading, setLoading] = useState(false);
  const download = async (version: DxfVersion | null = null) => {
    setLoading(true);
    const error = await downloadProjectDxf(project, version);
    setLoading(false);
    if (error !== null) {
      notifications.show({ color: 'clay', message: describeAppError(error) });
    }
  };
  return { loading, download };
};

// «Скачать DXF». С возможностью editedDxf сервер отдаёт DXF версии плана посадок, выбранной
// в шапке. Без неё, когда правки есть, кнопка становится меню: результат сервиса или слой
// посадок с правками, собранный в браузере.
export function DownloadDxf({ project }: DownloadDxfProps): JSX.Element {
  const state = useResultData(project);
  const withEditedDxf = useCapability('editedDxf');
  if (state.kind !== 'ready' || withEditedDxf) return <ServiceDxfButton project={project} />;
  return <DownloadWithEdits project={project} result={state.result} />;
}

function ServiceDxfButton({ project }: DownloadDxfProps): JSX.Element {
  const { loading, download } = useDownload(project);
  const withVersions = useCapability('plantingEdits');
  const { target } = usePlantingVersions(project.id);
  const version =
    target === null ? null : { version: target, fileSuffix: ` — версия ${String(target)}.dxf` };
  // С версиями без номера ушла бы последняя версия под именем без номера: ждём список.
  return (
    <Button
      loading={loading || (withVersions && target === null)}
      onClick={() => void download(version)}
    >
      Скачать DXF
    </Button>
  );
}

// Почему слой не собран — и что делать вместо этого.
const FAILURE_TEXT = {
  mismatch: (rms: number) =>
    `Правки не перенесены в координаты чертежа: координаты плана не сводятся к чертежу поворотом, сдвигом и масштабом (расхождение ${formatMeters(rms, 2)}). Скачайте результат сервиса и перенесите правки вручную.`,
  insufficient:
    'Правки не перенесены в координаты чертежа: неизменённых посадок сервиса с координатами чертежа меньше трёх, и план не переводится в чертёж. Скачайте результат сервиса.',
  binary:
    'Сервер отдал чертёж в двоичном DXF: браузер правки в него не вписывает. Скачайте только слой посадок и вставьте его в чертёж — координаты совпадают.',
  unsupported:
    'Чертёж сервера устроен не так, как ожидалось, и правки в него не вписаны. Скачайте только слой посадок и вставьте его в чертёж — координаты совпадают.',
} as const;

const failureText = (
  result: Exclude<EditedDxf, { kind: 'ready' }> | Exclude<EditedDrawing, { kind: 'ready' }>,
): string => {
  switch (result.kind) {
    case 'mismatch':
      return FAILURE_TEXT.mismatch(result.rms);
    case 'insufficient':
    case 'binary':
    case 'unsupported':
      return FAILURE_TEXT[result.kind];
    default: {
      const unexpected: never = result;
      return unexpected;
    }
  }
};

type DownloadWithEditsProps = { project: Project; result: LoadedResult };

function DownloadWithEdits({ project, result }: DownloadWithEditsProps): JSX.Element {
  const edits = usePlantingEdits(project.id, result.data.planting);
  const { loading, download } = useDownload(project);
  const [assembling, setAssembling] = useState(false);
  if (edits.counts.total === 0) {
    return (
      <Button loading={loading} onClick={() => void download()}>
        Скачать DXF
      </Button>
    );
  }

  // Чертёж сервера с итоговой расстановкой на слое результата: файл сервера читается
  // байтами, в браузере меняются только ENTITIES слоя результата и $HANDSEED.
  const downloadDrawing = async () => {
    const base = resultBase(result);
    if (base === null) {
      notifications.show({ color: 'clay', message: FAILURE_TEXT.insufficient });
      return;
    }
    const edited = editedResult(base, edits);
    setAssembling(true);
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      const server = await fetchProjectDxf(project.id);
      if (server.kind === 'error') {
        notifications.show({ color: 'clay', message: describeAppError(server.error) });
        return;
      }
      bytes = new Uint8Array(await server.file.arrayBuffer());
    } catch {
      // Ответ не прочитался (обрыв сети посреди тела) — объяснение, а не вечная загрузка кнопки.
      notifications.show({ color: 'clay', message: describeAppError({ kind: 'network' }) });
      return;
    } finally {
      setAssembling(false);
    }
    const drawing = editedDrawing(edited, bytes);
    if (drawing.kind !== 'ready') {
      notifications.show({ color: 'clay', message: failureText(drawing) });
      return;
    }
    saveFile(
      new Blob(drawing.parts, { type: 'application/dxf' }),
      projectFileName(project.name, ' — с правками.dxf'),
    );
  };

  // Слой собирается по щелчку: расчёт статусов и подгонка не нужны при каждом рендере шапки.
  const downloadLayer = () => {
    const base = resultBase(result);
    const layer =
      base === null ? ({ kind: 'insufficient' } as const) : editedDxf(editedResult(base, edits));
    if (layer.kind !== 'ready') {
      notifications.show({ color: 'clay', message: failureText(layer) });
      return;
    }
    saveFile(
      new Blob([layer.dxf], { type: 'application/dxf' }),
      projectFileName(project.name, ' — посадки с правками.dxf'),
    );
  };

  return (
    <Menu position="bottom-end">
      <Menu.Target>
        <Button
          loading={loading || assembling}
          // На заливке главной кнопки иконка берёт цвет текста.
          rightSection={<IconChevronDown size={20} stroke={1.5} aria-hidden />}
        >
          Скачать DXF
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item fw={600} onClick={() => void downloadDrawing()}>
          Результат с правками (DXF)
        </Menu.Item>
        <Menu.Item onClick={() => void download()}>Результат сервиса (DXF)</Menu.Item>
        <Menu.Item onClick={downloadLayer}>Только слой посадок (DXF)</Menu.Item>
        <Text size="xs" c="dimmed" className={classes.menuHint}>
          Вставьте слой в исходный чертёж: координаты совпадают
        </Text>
      </Menu.Dropdown>
    </Menu>
  );
}

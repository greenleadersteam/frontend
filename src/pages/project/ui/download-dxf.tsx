import { Button, Menu, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconChevronDown } from '@tabler/icons-react';
import { type JSX, useState } from 'react';

import {
  downloadProjectDxf,
  type DxfVariant,
  type Project,
  projectFileName,
} from '@/entities/project';
import { usePlantingEdits } from '@/features/edit-plantings';
import { describeAppError } from '@/shared/api';
import { useCapability } from '@/shared/config';
import { formatMeters } from '@/shared/lib/format';
import { saveFile } from '@/shared/lib/save-file';

import { type EditedDxf, editedDxf } from '../model/edited-dxf';
import { editedResult, type LoadedResult, useResultData } from '../model/result';
import classes from './project-header.module.css';

type DownloadDxfProps = { project: Project };

const useDownload = (project: Project) => {
  const [loading, setLoading] = useState(false);
  const download = async (variant: DxfVariant = 'edited') => {
    setLoading(true);
    const error = await downloadProjectDxf(project, variant);
    setLoading(false);
    if (error !== null) {
      notifications.show({ color: 'clay', message: describeAppError(error) });
    }
  };
  return { loading, download };
};

// «Скачать DXF». С возможностью editedDxf сервер сам отдаёт результат с правками. Без неё,
// когда правки есть, кнопка становится меню: результат сервиса или слой посадок с правками,
// собранный в браузере.
export function DownloadDxf({ project }: DownloadDxfProps): JSX.Element {
  const state = useResultData(project);
  const withEditedDxf = useCapability('editedDxf');
  if (state.kind !== 'ready' || withEditedDxf) return <ServiceDxfButton project={project} />;
  return <DownloadWithEdits project={project} result={state.result} />;
}

function ServiceDxfButton({ project }: DownloadDxfProps): JSX.Element {
  const { loading, download } = useDownload(project);
  return (
    <Button loading={loading} onClick={() => void download()}>
      Скачать DXF
    </Button>
  );
}

// Почему слой не собран — и что делать вместо этого.
const FAILURE_TEXT = {
  mismatch: (rms: number) =>
    `Слой не собран: координаты плана не сводятся к чертежу поворотом, сдвигом и масштабом (расхождение ${formatMeters(rms, 2)}). Скачайте результат сервиса и перенесите правки вручную.`,
  insufficient:
    'Слой не собран: в результате нет посадок сервиса с координатами чертежа, по которым план переводится в чертёж. Скачайте результат сервиса.',
} as const;

const failureText = (result: Exclude<EditedDxf, { kind: 'ready' }>) =>
  result.kind === 'mismatch' ? FAILURE_TEXT.mismatch(result.rms) : FAILURE_TEXT.insufficient;

type DownloadWithEditsProps = { project: Project; result: LoadedResult };

function DownloadWithEdits({ project, result }: DownloadWithEditsProps): JSX.Element {
  const edits = usePlantingEdits(project.id, result.data.planting);
  const { loading, download } = useDownload(project);
  if (edits.counts.total === 0) {
    return (
      <Button loading={loading} onClick={() => void download()}>
        Скачать DXF
      </Button>
    );
  }

  // Слой собирается по щелчку: расчёт статусов и подгонка не нужны при каждом рендере шапки.
  const downloadLayer = () => {
    const computed = editedResult(result, edits);
    const layer = computed === null ? ({ kind: 'insufficient' } as const) : editedDxf(computed);
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
          loading={loading}
          // На заливке главной кнопки иконка берёт цвет текста.
          rightSection={<IconChevronDown size={20} stroke={1.5} aria-hidden />}
        >
          Скачать DXF
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={() => void download()}>Результат сервиса (DXF)</Menu.Item>
        <Menu.Item onClick={downloadLayer}>Слой посадок с правками (DXF)</Menu.Item>
        <Text size="xs" c="dimmed" className={classes.menuHint}>
          Вставьте слой в исходный чертёж: координаты совпадают
        </Text>
      </Menu.Dropdown>
    </Menu>
  );
}

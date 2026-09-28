import { Alert, Button, Stack, Text } from '@mantine/core';
import type { JSX } from 'react';

import type { Project } from '@/entities/project';

import {
  removeBrowserGeoreference,
  useBrowserGeoreference,
} from '../model/use-project-georeference';

type StaleGeoreferenceAlertProps = { project: Project };

// Привязка в браузере сделана до переобработки проекта: чертёж мог смениться, и план показан
// в координатах чертежа, пока пользователь не привяжет его снова.
export function StaleGeoreferenceAlert({
  project,
}: StaleGeoreferenceAlertProps): JSX.Element | null {
  const stored = useBrowserGeoreference(project);
  if (stored.kind !== 'stale') return null;
  return (
    <Alert color="ochre" variant="light">
      <Stack gap="sm" align="flex-start">
        <Text size="sm">
          Привязка к карте сделана для прошлой обработки проекта. Чертёж мог измениться, поэтому
          план показан в координатах чертежа. Привяжите его заново или удалите старую привязку.
        </Text>
        <Button
          size="compact-md"
          color="clay"
          onClick={() => {
            removeBrowserGeoreference(project.id);
          }}
        >
          Удалить привязку
        </Button>
      </Stack>
    </Alert>
  );
}

import { Button, Group, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import type { JSX } from 'react';
import { z } from 'zod';

import type { ProjectDetails } from '../model/wizard';

// Лимиты — из contracts/openapi.proposed.yaml (ProjectCreateRequest); у бэкенда это задача P2-4.
const NAME_MAX = 120;
const NAME_COUNTER_FROM = 100;
const DESCRIPTION_MAX = 1000;

const detailsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Укажите название проекта.')
    .max(NAME_MAX, `Название — не длиннее ${String(NAME_MAX)} символов. Сократите его.`),
  description: z
    .string()
    .trim()
    .max(
      DESCRIPTION_MAX,
      `Описание — не длиннее ${String(DESCRIPTION_MAX)} символов. Сократите его.`,
    ),
});

type DetailsStepProps = {
  initial: ProjectDetails | null;
  onSubmit: (details: ProjectDetails) => void;
  // Почему создать проект нельзя (сервер не умеет); null — можно.
  blockedReason: string | null;
};

export function DetailsStep({ initial, onSubmit, blockedReason }: DetailsStepProps): JSX.Element {
  const form = useForm({
    mode: 'controlled',
    initialValues: initial ?? { name: '', description: '' },
    validate: schemaResolver(detailsSchema, { sync: true }),
    // Ошибка появляется после ухода из поля и при попытке перейти дальше, не во время ввода.
    validateInputOnBlur: true,
    transformValues: ({ name, description }) => ({
      name: name.trim(),
      description: description.trim(),
    }),
  });
  const nameLength = form.getValues().name.trim().length;

  return (
    <form onSubmit={form.onSubmit(onSubmit)} noValidate>
      <Stack gap="lg">
        <TextInput
          label="Название проекта"
          description="Так проект будет называться в списке и в имени файла результата"
          withAsterisk
          rightSection={
            nameLength > NAME_COUNTER_FROM ? `${String(nameLength)}/${String(NAME_MAX)}` : undefined
          }
          rightSectionWidth="4rem"
          key={form.key('name')}
          {...form.getInputProps('name')}
        />
        <Textarea
          label="Описание"
          description="Необязательно"
          autosize
          minRows={3}
          maxRows={10}
          key={form.key('description')}
          {...form.getInputProps('description')}
        />
        {blockedReason !== null && (
          <Text id="create-blocked" size="sm" c="dimmed">
            {blockedReason}
          </Text>
        )}
        <Group justify="flex-end">
          <Button
            type="submit"
            disabled={blockedReason !== null}
            aria-describedby={blockedReason === null ? undefined : 'create-blocked'}
          >
            Далее: файлы
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

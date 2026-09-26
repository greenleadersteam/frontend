import {
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { IconDownload, IconFileZip, IconTrees, IconUpload } from '@tabler/icons-react';
import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router';

import { type ProjectState, ProjectStatusBadge } from '@/entities/project';
import { paths, PRODUCT_NAME, projectPath } from '@/shared/config';
import { EmptyState, Icon } from '@/shared/ui';

import classes from './dev-ui-page.module.css';

// Песочница для сверки кода с утверждённым образцом (design.md). Доступна только в dev-режимах.

const numberFormat = new Intl.NumberFormat('ru-RU');
const megabytes = (sent: number, total: number) =>
  `${numberFormat.format(sent)} из ${numberFormat.format(total)}\u00A0МБ`;

const STATES: { state: ProjectState; progressPct?: number; caption?: string }[] = [
  { state: { kind: 'draft' } },
  { state: { kind: 'processing', stage: 'queued' }, progressPct: 0 },
  { state: { kind: 'processing', stage: 'parsing' }, progressPct: 10 },
  { state: { kind: 'processing', stage: 'georeferencing' }, progressPct: 40 },
  { state: { kind: 'processing', stage: 'zoning_layout' }, progressPct: 70 },
  { state: { kind: 'processing', stage: 'exporting' }, progressPct: 90 },
  { state: { kind: 'unknown' } },
  { state: { kind: 'ready' }, caption: `обработано за 3\u00A0мин 12\u00A0с` },
  { state: { kind: 'failed', error: null } },
];

type SectionProps = { title: string; children: ReactNode };

function Section({ title, children }: SectionProps): JSX.Element {
  return (
    <Stack gap="lg" component="section">
      <Title order={2}>{title}</Title>
      {children}
    </Stack>
  );
}

export function DevUiPage(): JSX.Element {
  return (
    <>
      <title>{`Песочница оформления — ${PRODUCT_NAME}`}</title>
      <Title order={1}>Песочница оформления</Title>

      <Stack className={classes.sections}>
        <Section title="Кнопки">
          <Group>
            <Button>Загрузить проект</Button>
            <Button variant="default">Скачать DXF</Button>
            <Button variant="subtle">Отменить</Button>
          </Group>
          <Group>
            <Button disabled>Загрузить проект</Button>
            <Button variant="default" disabled>
              Скачать DXF
            </Button>
            <Button variant="subtle" disabled>
              Отменить
            </Button>
          </Group>
          <Group>
            <Button loading>Загрузить проект</Button>
            <Button variant="default" loading>
              Скачать DXF
            </Button>
          </Group>
        </Section>

        <Section title="Поля">
          <SimpleGrid cols={2} spacing="xl" className={classes.fields}>
            <TextInput
              label="Название проекта"
              description="Например, адрес участка"
              defaultValue="Сквер на Покровке"
            />
            <TextInput label="Название проекта" error="Укажите название проекта." defaultValue="" />
            <Textarea
              label="Описание"
              description="Необязательно"
              defaultValue="Благоустройство сквера, этап 1"
            />
            <Select
              label="Главный DXF"
              description="Бэкенд нашёл несколько подходящих файлов"
              data={['ГП/Генплан.dxf', 'ГП/Генплан_изм2.dxf', 'Сети/Сводный_план.dxf']}
              defaultValue="ГП/Генплан.dxf"
            />
            <Stack gap="sm">
              <Checkbox label="Деревья" defaultChecked />
              <Checkbox label="Кустарники" />
              <Checkbox label="Недоступно" disabled />
            </Stack>
            <Stack gap="sm">
              <Switch label="Показывать зоны запрета" defaultChecked />
              <Switch label="Показывать отклонённые места" />
            </Stack>
          </SimpleGrid>
        </Section>

        <Section title="Прогресс">
          <Stack gap="xs" className={classes.fields}>
            <Progress value={60} aria-label="Загрузка архива" />
            <Text size="sm" c="dimmed" className={classes.numbers}>
              {megabytes(61, 102)}, осталось около 40 секунд
            </Text>
          </Stack>
        </Section>

        <Section title="Статусы">
          <Stack gap="sm">
            {STATES.map(({ state, progressPct, caption }) => (
              <Group key={JSON.stringify(state)} gap="md">
                <ProjectStatusBadge state={state} progressPct={progressPct} />
                <ProjectStatusBadge state={state} />
                {caption !== undefined && (
                  <Text size="sm" c="dimmed">
                    {caption}
                  </Text>
                )}
              </Group>
            ))}
            <div className={classes.narrow}>
              <Badge variant="failed">Длинный текст бейджа обрезается многоточием</Badge>
            </div>
          </Stack>
        </Section>

        <Section title="Карточка проекта">
          <SimpleGrid cols={3} spacing="lg" className={classes.cards}>
            <Card
              component={Link}
              to={projectPath('5c0b7f2e9a3d4e61b8f0c2a7d9e4b1f3')}
              className={classes.card}
              padding={0}
            >
              <div className={classes.preview} />
              <Stack gap="xs" className={classes.cardBody}>
                <ProjectStatusBadge state={{ kind: 'ready' }} />
                <Text lineClamp={2} className={classes.cardTitle}>
                  Сквер на Покровке
                </Text>
                <Text size="sm" c="dimmed" lineClamp={2}>
                  Благоустройство сквера, этап 1
                </Text>
              </Stack>
            </Card>
            <Card
              component={Link}
              to={projectPath('3f7b1d9c5e2a4b8d6f0c3e5a7b9d1f2c')}
              className={classes.card}
              padding={0}
            >
              <div className={classes.preview} />
              <Stack gap="xs" className={classes.cardBody}>
                <ProjectStatusBadge
                  state={{ kind: 'processing', stage: 'parsing' }}
                  progressPct={10}
                />
                <Text lineClamp={2} className={classes.cardTitle}>
                  Чистопрудный бульвар, участок 2, реконструкция газона вдоль бульвара
                </Text>
              </Stack>
            </Card>
          </SimpleGrid>
        </Section>

        <Section title="Пустое состояние">
          <EmptyState
            title="Проектов пока нет"
            description="Загрузите архив с подосновой и инженерными сетями, чтобы получить план посадок."
            action={
              <Button component={Link} to={paths.projectNew}>
                Загрузить проект
              </Button>
            }
          />
        </Section>

        <Section title="Иконки">
          <Group gap="xl">
            <Icon icon={IconUpload} />
            <Icon icon={IconDownload} />
            <Icon icon={IconFileZip} size={24} />
            <Icon icon={IconTrees} size={24} accent />
          </Group>
        </Section>
      </Stack>
    </>
  );
}

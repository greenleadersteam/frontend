import { Button, Group, Modal, Stack, Stepper, Text, Title } from '@mantine/core';
import { type JSX, useEffect, useReducer, useRef } from 'react';

import { useCapability } from '@/shared/config';

import { useArchiveUpload } from '../model/use-archive-upload';
import { useLeaveGuard } from '../model/use-leave-guard';
import { initialWizardState, type WizardEntry, wizardReducer } from '../model/wizard';
import { ArchiveStep } from './archive-step';
import { DetailsStep } from './details-step';
import { ProcessingStep } from './processing-step';
import { SiteStep } from './site-step';
import { UploadProgress } from './upload-progress';
import classes from './upload-wizard.module.css';

type UploadWizardProps = {
  // Существующий проект из списка: мастер начинается с шага «Файлы» или с выбора главного DXF.
  entry: WizardEntry | null;
};

export function UploadWizard({ entry }: UploadWizardProps): JSX.Element {
  const [state, dispatch] = useReducer(wizardReducer, entry, initialWizardState);
  const upload = useArchiveUpload(state, dispatch);
  const { blocker, leaving, leave } = useLeaveGuard(state, upload.abort);
  const { step, project } = state;
  const uploading = state.upload.kind === 'creating' || state.upload.kind === 'uploading';
  // Сервер без optionalBbox требует область участка (bbox_user): для нового проекта мастер
  // показывает шаг «Участок». Проект из списка уже создан, и шага у него нет.
  const withSite = !useCapability('optionalBbox') && entry === null;
  const steps = withSite
    ? (['details', 'site', 'archive', 'processing'] as const)
    : (['details', 'archive', 'processing'] as const);

  // При смене шага кнопка, на которой был фокус, исчезает: фокус переходит на заголовок,
  // чтобы клавиатура и скринридер не теряли позицию. Первый показ фокус не трогает.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStepRef = useRef(step);
  useEffect(() => {
    if (shownStepRef.current === step) return;
    shownStepRef.current = step;
    headingRef.current?.focus();
  }, [step]);

  return (
    <Stack gap="xl" className={classes.root}>
      <Title order={1} ref={headingRef} tabIndex={-1} className={classes.heading}>
        {entry?.project.name ?? 'Новый проект'}
      </Title>

      <Stepper
        active={steps.findIndex((candidate) => candidate === step)}
        allowNextStepsSelect={false}
      >
        <Stepper.Step label="Описание" />
        {withSite && <Stepper.Step label="Участок" />}
        <Stepper.Step label="Файлы" />
        <Stepper.Step label="Загрузка и обработка" />
      </Stepper>

      {step === 'details' && (
        <DetailsStep
          initial={state.details}
          onSubmit={(details) => {
            dispatch({ type: 'detailsSubmitted', details, next: withSite ? 'site' : 'archive' });
          }}
          nextLabel={withSite ? 'Далее: участок' : 'Далее: файлы'}
        />
      )}

      {step === 'site' && (
        <SiteStep
          initial={state.site}
          onBack={() => {
            dispatch({ type: 'back' });
          }}
          onSubmit={(site) => {
            dispatch({ type: 'siteChosen', site });
          }}
        />
      )}

      {step === 'archive' && (
        <ArchiveStep
          archive={state.archive}
          notice={state.archiveNotice}
          // Назад к описанию — только пока проект не создан: потом правка названия потерялась бы.
          onBack={
            project === null
              ? () => {
                  dispatch({ type: 'back' });
                }
              : null
          }
          onChecked={(archive) => {
            dispatch({ type: 'archiveChecked', archive });
          }}
          onCleared={() => {
            dispatch({ type: 'archiveCleared' });
          }}
          onUpload={() => void upload.start()}
        />
      )}

      {step === 'processing' &&
        (state.upload.kind === 'accepted' && project !== null ? (
          <ProcessingStep
            projectId={project.id}
            acceptedAt={state.upload.acceptedAt}
            onUploadAnother={() => {
              dispatch({ type: 'returnedToArchive', notice: null });
            }}
          />
        ) : (
          state.upload.kind !== 'idle' &&
          state.upload.kind !== 'accepted' && (
            <UploadProgress
              upload={state.upload}
              onCancel={() => void upload.cancel()}
              onRetry={() => void upload.start()}
            />
          )
        ))}

      <Modal
        opened={blocker.state === 'blocked'}
        onClose={() => {
          blocker.reset?.();
        }}
        title="Уйти со страницы?"
        // Пока проект удаляется, окно закрывается только переходом.
        closeOnEscape={!leaving}
        closeOnClickOutside={!leaving}
        withCloseButton={!leaving}
      >
        <Stack gap="lg">
          <Text>
            {uploading
              ? 'Загрузка будет прервана, а проект удалён. Уйти со страницы?'
              : 'Проект без архива будет удалён. Уйти со страницы?'}
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              disabled={leaving}
              onClick={() => {
                blocker.reset?.();
              }}
            >
              Остаться
            </Button>
            <Button color="clay" loading={leaving} onClick={() => void leave()}>
              Уйти
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

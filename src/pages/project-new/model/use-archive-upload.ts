import { type Dispatch, useEffect, useRef } from 'react';

import {
  isProcessing,
  useCreateProjectMutation,
  useDeleteProjectMutation,
  useLazyGetProjectQuery,
} from '@/entities/project';
import { type AppError, baseApi, describeAppError, toAppError, uploadArchive } from '@/shared/api';
import { useAppDispatch } from '@/shared/lib/store';

import { toBboxUser } from './site';
import type { WizardAction, WizardState } from './wizard';

type ArchiveUpload = {
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  // Прервать без смены шага: при уходе со страницы.
  abort: () => void;
};

// Создание проекта и загрузка архива — два запроса (api.md). Проект создаётся только
// здесь, при загрузке, чтобы шаги мастера не плодили пустые проекты.
export function useArchiveUpload(
  state: WizardState,
  dispatch: Dispatch<WizardAction>,
): ArchiveUpload {
  const [createProject] = useCreateProjectMutation();
  const [deleteProject] = useDeleteProjectMutation();
  const [fetchProject] = useLazyGetProjectQuery();
  const appDispatch = useAppDispatch();
  const controllerRef = useRef<AbortController | null>(null);
  // Номер попытки: отмена и уход со страницы его меняют. Ответ устаревшей попытки
  // ничего не меняет, а проект, созданный уже после отмены, удаляется.
  const attemptRef = useRef(0);

  // Загрузка отменяется и при уходе со страницы (security.md), в том числе в проект,
  // который удалять не нужно, и пока проект ещё создаётся.
  useEffect(
    () => () => {
      attemptRef.current += 1;
      controllerRef.current?.abort();
    },
    [],
  );

  const start = async () => {
    const { archive, details, site, project: existing } = state;
    if (archive === null) return;
    // Без проекта мастер всегда проходит шаг «Описание»: details тогда заполнены.
    const toCreate = existing === null ? details : null;
    if (existing === null && toCreate === null) return;
    attemptRef.current += 1;
    const attempt = attemptRef.current;
    const isCurrent = () => attemptRef.current === attempt;
    dispatch({ type: 'uploadRequested' });

    let project = existing;
    if (toCreate !== null) {
      // Область участка есть только у сервера без optionalBbox: там bbox_user обязателен.
      const created = await createProject({
        name: toCreate.name,
        description: toCreate.description === '' ? null : toCreate.description,
        ...(site !== null && { bbox_user: toBboxUser(site) }),
      });
      if ('error' in created) {
        if (isCurrent()) dispatch({ type: 'uploadFailed', error: toAppError(created.error) });
        return;
      }
      if (!isCurrent()) {
        await deleteProject(created.data.id);
        return;
      }
      project = { id: created.data.id, name: created.data.name, keepOnLeave: false };
      dispatch({ type: 'projectCreated', id: project.id, name: project.name });
    }
    // Сужение типа: проект либо был, либо только что создан.
    if (project === null) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    const result = await uploadArchive(project.id, archive.file, {
      signal: controller.signal,
      onProgress: ({ sentBytes, totalBytes }) => {
        dispatch({ type: 'uploadProgressed', sentBytes, totalBytes, at: performance.now() });
      },
    });
    controllerRef.current = null;
    if (!isCurrent()) return;

    switch (result.kind) {
      case 'accepted':
        dispatch({ type: 'uploadAccepted', at: Date.now() });
        appDispatch(
          baseApi.util.invalidateTags([
            { type: 'Project', id: project.id },
            { type: 'Project', id: 'LIST' },
          ]),
        );
        return;
      case 'failed': {
        const { error } = result;
        // 413 исправляется другим архивом — назад к выбору с объяснением.
        if (error.kind === 'http' && error.status === 413) {
          dispatch({ type: 'returnedToArchive', notice: describeAppError(error) });
          return;
        }
        // 409 — статус проекта не позволяет загрузку, чаще всего обработку уже запустили
        // в другой вкладке. Показываем фактическое состояние, а не выбор архива.
        if (error.kind === 'http' && error.status === 409) {
          const refreshed = await fetchProject(project.id);
          if (!isCurrent()) return;
          // Сбой самого запроса — не конфликт: показываем его причину и даём повторить.
          if (refreshed.error !== undefined) {
            dispatch({ type: 'uploadFailed', error: toAppError(refreshed.error) });
            return;
          }
          const current = refreshed.data;
          if (
            current !== undefined &&
            (isProcessing(current.state) || current.state.kind === 'ready')
          ) {
            // Только что полученные данные актуальны: acceptedAt = 0.
            dispatch({ type: 'uploadAccepted', at: 0 });
            return;
          }
          dispatch({ type: 'uploadConflicted', projectId: project.id });
          return;
        }
        dispatch({ type: 'uploadFailed', error });
        return;
      }
      case 'aborted':
        return;
      default: {
        const unexpected: never = result;
        return unexpected;
      }
    }
  };

  const abort = () => {
    controllerRef.current?.abort();
  };

  const cancel = async () => {
    attemptRef.current += 1;
    abort();
    const { project } = state;
    const deletable = project !== null && !project.keepOnLeave;
    // Если удалить не удалось, проект остаётся в мастере: следующая загрузка пойдёт в него,
    // а не создаст дубль.
    const deleted = deletable && !('error' in (await deleteProject(project.id)));
    dispatch({ type: 'uploadCancelled', projectDeleted: deleted });
  };

  return { start, cancel, abort };
}

// Задеплоенный бэкенд требует bbox_user (../backend/greenplan/api/schemas.py:18). Мастер
// спрашивает область, если сервер не объявил optionalBbox; 422 здесь значит, что конфиг
// объявил возможность, которой у сервера нет.
export function describeUploadError(error: AppError): string {
  if (error.kind === 'validation' && 'bbox_user' in error.fields) {
    return 'Сервер требует указать область участка, а настройки говорят, что не требует. Сообщите администратору.';
  }
  return describeAppError(error);
}

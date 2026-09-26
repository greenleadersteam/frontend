import { useEffect, useState } from 'react';
import { type Blocker, useBlocker } from 'react-router';

import { useDeleteProjectMutation } from '@/entities/project';
import { getRuntimeConfig } from '@/shared/config';

import type { WizardState } from './wizard';

type LeaveGuard = {
  blocker: Blocker;
  // Уход подтверждён и идёт удаление: окно подтверждения не закрывается и не нажимается.
  leaving: boolean;
  leave: () => Promise<void>;
};

// Уход до ответа 202 удаляет созданный мастером проект (api.md, «Загрузка файла»):
// внутри приложения — после подтверждения, при закрытии вкладки — keepalive-запросом.
export function useLeaveGuard(state: WizardState, abortUpload: () => void): LeaveGuard {
  const [deleteProject] = useDeleteProjectMutation();
  const [leaving, setLeaving] = useState(false);
  const { project } = state;
  const guardedId = project !== null && !project.keepOnLeave ? project.id : null;
  const blocker = useBlocker(guardedId !== null);

  useEffect(() => {
    if (guardedId === null) return;
    const baseUrl = getRuntimeConfig().apiBaseUrl.replace(/\/$/, '');
    // pagehide срабатывает и при закрытии вкладки, и при переходе. Страница, ушедшая
    // в bfcache (persisted), может вернуться кнопкой «Назад» — её проект не удаляется.
    // keepalive — best effort: запрос переживает выгрузку страницы, но результата не будет.
    const onPageHide = (event: PageTransitionEvent) => {
      if (event.persisted) return;
      void fetch(`${baseUrl}/projects/${encodeURIComponent(guardedId)}`, {
        method: 'DELETE',
        keepalive: true,
      });
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [guardedId]);

  // Архив приняли, пока открыто окно подтверждения: удалять нечего, уход не держим.
  useEffect(() => {
    if (blocker.state === 'blocked' && guardedId === null) blocker.proceed();
  }, [blocker, guardedId]);

  const leave = async () => {
    if (blocker.state !== 'blocked' || leaving) return;
    setLeaving(true);
    abortUpload();
    if (guardedId !== null) await deleteProject(guardedId);
    blocker.proceed();
  };

  return { blocker, leaving, leave };
}

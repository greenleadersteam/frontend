import type { TypedUseQueryHookResult } from '@reduxjs/toolkit/query/react';
import { useEffect, useState } from 'react';

import type { AppBaseQuery } from '@/shared/api';

import { projectApi, useGetProjectQuery, useListProjectsQuery } from '../api/project-api';
import { isProcessing, type Project } from './project';

export const POLLING_INTERVAL_MS = 2000;
export const POLLING_LIMIT_MS = 30 * 60 * 1000;

type PollingControl = {
  // Предохранитель сработал: обработка ещё идёт, но опрос остановлен.
  pollingStalled: boolean;
  checkAgain: () => void;
};

// session различает отсчёты: новая обработка после завершения прошлой или другой проект
// в том же компоненте начинают отсчёт заново.
function usePollingLimit(active: boolean, session: string) {
  const [expired, setExpired] = useState(false);
  const [counted, setCounted] = useState({ active, session });

  if (active !== counted.active || session !== counted.session) {
    setCounted({ active, session });
    setExpired(false);
  }

  useEffect(() => {
    if (!active || expired) return;
    const timer = setTimeout(() => {
      setExpired(true);
    }, POLLING_LIMIT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [active, expired, session]);

  return {
    expired: active && expired,
    reset: () => {
      setExpired(false);
    },
  };
}

// refetchOnFocus: без фокуса опрос стоит, а отсчёт предохранителя идёт; вернувшись,
// пользователь должен увидеть свежее состояние, а не ложное «идёт дольше обычного».
const pollingOptions = (active: boolean, expired: boolean) => ({
  pollingInterval: active && !expired ? POLLING_INTERVAL_MS : 0,
  skipPollingIfUnfocused: true,
  refetchOnFocus: true,
});

// Опрос включается, только пока идёт обработка. Прочитать состояние до подписки с опросом
// позволяет useQueryState: обе подписки смотрят в одну запись кэша.
export function useProjectWithPolling(
  id: string,
): TypedUseQueryHookResult<Project, string, AppBaseQuery> & PollingControl {
  const { data } = projectApi.endpoints.getProject.useQueryState(id);
  const active = data !== undefined && isProcessing(data.state);
  const limit = usePollingLimit(active, id);
  const query = useGetProjectQuery(id, pollingOptions(active, limit.expired));

  return {
    ...query,
    pollingStalled: limit.expired,
    checkAgain: () => {
      limit.reset();
      void query.refetch();
    },
  };
}

// Список опрашивается одним запросом, пока в нём есть хотя бы одна идущая обработка.
export function useProjectsWithPolling(): TypedUseQueryHookResult<
  Project[],
  undefined,
  AppBaseQuery
> &
  PollingControl {
  const { data } = projectApi.endpoints.listProjects.useQueryState(undefined);
  const active = data?.some((project) => isProcessing(project.state)) === true;
  const limit = usePollingLimit(active, 'list');
  const query = useListProjectsQuery(undefined, pollingOptions(active, limit.expired));

  return {
    ...query,
    pollingStalled: limit.expired,
    checkAgain: () => {
      limit.reset();
      void query.refetch();
    },
  };
}

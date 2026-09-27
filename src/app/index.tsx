import '@mantine/core/styles.layer.css';
import '@mantine/dropzone/styles.layer.css';
import '@mantine/notifications/styles.layer.css';
import './styles/fonts.css';
import './styles/global.css';

import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';

import { cssVariablesResolver, theme } from '@/shared/theme';

import { store } from './model/store';
import { routes } from './routes';

const router = createBrowserRouter(routes);

// SSR нет, «гидратировать» нечего: первый экран дожидается своего ленивого маршрута и
// рисуется сразу целиком, без HydrateFallback. Сбой загрузки маршрута тоже завершает
// инициализацию — его покажет граница ошибок маршрута.
function routerInitialized(): Promise<void> {
  if (router.state.initialized) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = router.subscribe((state) => {
      if (!state.initialized) return;
      unsubscribe();
      resolve();
    });
  });
}

export async function renderApp(container: HTMLElement): Promise<void> {
  await routerInitialized();
  createRoot(container).render(
    <StrictMode>
      <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver}>
        <Notifications />
        <Provider store={store}>
          <RouterProvider router={router} />
        </Provider>
      </MantineProvider>
    </StrictMode>,
  );
}

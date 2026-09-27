import { MantineProvider, mergeThemeOverrides, Popover } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { configureStore, type Reducer } from '@reduxjs/toolkit';
import {
  render,
  renderHook,
  type RenderHookResult,
  type RenderResult,
} from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { Provider } from 'react-redux';
import { createMemoryRouter, type InitialEntry, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';

import { baseApi } from '@/shared/api';
import { theme } from '@/shared/theme';

// В jsdom у всех элементов нулевые размеры, и floating-ui считает опорный элемент меню
// скрытым: с hideDetached Mantine прячет выпадающее меню (display: none), и его пункты
// пропадают из дерева доступности. В браузере размеры настоящие, поэтому правка только здесь.
//
// Переходы Mantine в jsdom идут цепочкой requestAnimationFrame → requestAnimationFrame →
// setTimeout (core/components/Transition/use-transition.mjs). Под нагрузкой меню не успевало
// появиться за таймаут findBy, а таймер, не сработавший к концу файла, стрелял после сноса jsdom
// («window is not defined»). С уменьшенным движением переход синхронный.
const testTheme = mergeThemeOverrides(theme, {
  respectReducedMotion: true,
  components: { Popover: Popover.extend({ defaultProps: { hideDetached: false } }) },
});

export { contourOf, GEOREFERENCE_SAMPLE, portedGroup, sampleContour } from './georeference';
export { enterViewport } from './intersection-observer';
export { buildZip } from './zip-fixture';
export { resetMockDb, server } from '@/shared/api/mocks/node';

// shared не знает о слайсах верхних слоёв: тест, которому они нужны, передаёт их сам.
type Reducers = Record<string, Reducer>;

const createTestStore = (reducers: Reducers) =>
  configureStore({
    reducer: { [baseApi.reducerPath]: baseApi.reducer, ...reducers },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(baseApi.middleware),
  });

export function renderWithProviders(
  routes: RouteObject[],
  initialEntry: InitialEntry,
  reducers: Reducers = {},
): RenderResult {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });

  return render(
    <MantineProvider theme={testTheme}>
      <Notifications />
      <Provider store={createTestStore(reducers)}>
        <RouterProvider router={router} />
      </Provider>
    </MantineProvider>,
  );
}

export const renderWithTheme = (ui: ReactElement): RenderResult =>
  render(<MantineProvider theme={testTheme}>{ui}</MantineProvider>);

export function renderHookWithStore<Result>(
  hook: () => Result,
  reducers: Reducers = {},
): RenderHookResult<Result, unknown> {
  const store = createTestStore(reducers);
  return renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    ),
  });
}

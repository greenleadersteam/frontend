import { MantineProvider, mergeThemeOverrides, Popover } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { configureStore } from '@reduxjs/toolkit';
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
const testTheme = mergeThemeOverrides(theme, {
  components: { Popover: Popover.extend({ defaultProps: { hideDetached: false } }) },
});

export { enterViewport } from './intersection-observer';
export { buildZip } from './zip-fixture';
export { resetMockDb, server } from '@/shared/api/mocks/node';

const createTestStore = () =>
  configureStore({
    reducer: { [baseApi.reducerPath]: baseApi.reducer },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(baseApi.middleware),
  });

export function renderWithProviders(
  routes: RouteObject[],
  initialEntry: InitialEntry,
): RenderResult {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });

  return render(
    <MantineProvider theme={testTheme}>
      <Notifications />
      <Provider store={createTestStore()}>
        <RouterProvider router={router} />
      </Provider>
    </MantineProvider>,
  );
}

export const renderWithTheme = (ui: ReactElement): RenderResult =>
  render(<MantineProvider theme={testTheme}>{ui}</MantineProvider>);

export function renderHookWithStore<Result>(hook: () => Result): RenderHookResult<Result, unknown> {
  const store = createTestStore();
  return renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    ),
  });
}

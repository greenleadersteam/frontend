import { MantineProvider } from '@mantine/core';
import { configureStore } from '@reduxjs/toolkit';
import {
  render,
  renderHook,
  type RenderHookResult,
  type RenderResult,
} from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { Provider } from 'react-redux';
import { createMemoryRouter, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';

import { baseApi } from '@/shared/api';
import { theme } from '@/shared/config';

export { resetMockDb, server } from '@/shared/api/mocks/node';

const createTestStore = () =>
  configureStore({
    reducer: { [baseApi.reducerPath]: baseApi.reducer },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(baseApi.middleware),
  });

export function renderWithProviders(routes: RouteObject[], initialPath: string): RenderResult {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });

  return render(
    <MantineProvider theme={theme}>
      <Provider store={createTestStore()}>
        <RouterProvider router={router} />
      </Provider>
    </MantineProvider>,
  );
}

export const renderWithTheme = (ui: ReactElement): RenderResult =>
  render(<MantineProvider theme={theme}>{ui}</MantineProvider>);

export function renderHookWithStore<Result>(hook: () => Result): RenderHookResult<Result, unknown> {
  const store = createTestStore();
  return renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    ),
  });
}

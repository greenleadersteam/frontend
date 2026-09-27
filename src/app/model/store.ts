import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';

import { baseApi } from '@/shared/api';

export const store = configureStore({
  reducer: { [baseApi.reducerPath]: baseApi.reducer },
  // Кэш RTK Query — JSON с сервера, сериализуемый по построению. Dev-проверки обходили бы его
  // целиком на каждом действии: на готовом проекте с тысячами посадок это около секунды.
  // Сейчас в store только кэш API. Исключение payload действует на все действия: когда появится
  // клиентский срез, его нужно сузить до действий API через ignoredActions.
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredPaths: [baseApi.reducerPath],
        ignoredActionPaths: ['payload', 'meta.arg', 'meta.baseQueryMeta'],
      },
      immutableCheck: { ignoredPaths: [baseApi.reducerPath] },
    }).concat(baseApi.middleware),
});

// Без этого не работают refetchOnFocus и skipPollingIfUnfocused.
setupListeners(store.dispatch);

declare global {
  type RootState = ReturnType<typeof store.getState>;
  type AppDispatch = typeof store.dispatch;
}

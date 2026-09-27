import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';

import { plantingEditsSlice } from '@/features/edit-plantings';
import { baseApi } from '@/shared/api';

export const store = configureStore({
  reducer: {
    [baseApi.reducerPath]: baseApi.reducer,
    [plantingEditsSlice.name]: plantingEditsSlice.reducer,
  },
  // Кэш RTK Query — JSON с сервера, сериализуемый по построению. Dev-проверки обходили бы его
  // целиком на каждом действии: на готовом проекте с тысячами посадок это около секунды.
  // Payload не проверяется ни у каких действий: у действий API он и есть этот кэш, а по типу
  // их не отделить. Правки посадок — малые объекты из кода; их состояние проверяется, потому
  // что ignoredPaths покрывает только кэш API.
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

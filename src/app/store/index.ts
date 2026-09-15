import { configureStore } from '@reduxjs/toolkit';
import authReducer from '../../features/auth/slice';
import connectionSettingsReducer from '../../features/connectionSettings/slice';
import { persistConnectionSettings } from '../../features/connectionSettings/slice';
import dashboardReducer from '../../features/dashboard/slice';
import type { Dependencies } from '../dependencies';

export interface StoreConfig {
  dependencies: Dependencies;
}

export function createStore(config: StoreConfig) {
  const { dependencies } = config;

  const store = configureStore({
    reducer: {
      auth: authReducer,
      connectionSettings: connectionSettingsReducer,
      dashboard: dashboardReducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        thunk: {
          extraArgument: dependencies,
        },
      }),
  });

  // Persist connection settings (IP/port, devices, register offsets) on
  // every change so edits survive a reload. The saved blob does include
  // whatever connection status happened to be current at save time, but
  // slice.ts's loadPersistedState() always resets it back to disconnected
  // on the next load, since the real socket lives in the gateway process,
  // not this store.
  let previousConnectionSettings = store.getState().connectionSettings;
  store.subscribe(() => {
    const current = store.getState().connectionSettings;
    if (current !== previousConnectionSettings) {
      previousConnectionSettings = current;
      persistConnectionSettings(current);
    }
  });

  return store;
}

// Type for the store instance (will be created in main.tsx)
export type AppStore = ReturnType<typeof createStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];

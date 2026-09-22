import { configureStore } from '@reduxjs/toolkit';
import authReducer from '../../features/auth/slice';
import connectionSettingsReducer from '../../features/connectionSettings/slice';
import { persistConnectionSettings } from '../../features/connectionSettings/slice';
import dashboardReducer from '../../features/dashboard/slice';
import mailSettingsReducer from '../../features/mailSettings/slice';
import { persistMailSettings } from '../../features/mailSettings/slice';
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
      mailSettings: mailSettingsReducer,
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
  let previousMailSettings = store.getState().mailSettings;
  store.subscribe(() => {
    const state = store.getState();
    if (state.connectionSettings !== previousConnectionSettings) {
      previousConnectionSettings = state.connectionSettings;
      persistConnectionSettings(state.connectionSettings);
    }
    if (state.mailSettings !== previousMailSettings) {
      previousMailSettings = state.mailSettings;
      persistMailSettings(state.mailSettings);
    }
  });

  return store;
}

// Type for the store instance (will be created in main.tsx)
export type AppStore = ReturnType<typeof createStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];

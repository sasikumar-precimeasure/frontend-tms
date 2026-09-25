import { configureStore } from '@reduxjs/toolkit';
import authReducer from '../../features/auth/slice';
import connectionSettingsReducer from '../../features/connectionSettings/slice';
import { persistConnectionSettings } from '../../features/connectionSettings/slice';
import dashboardReducer from '../../features/dashboard/slice';
import mailSettingsReducer from '../../features/mailSettings/slice';
import usersReducer from '../../features/users/slice';
import auditLogReducer from '../../features/auditLog/slice';
import toastReducer from '../../features/toast/slice';
import notificationsReducer from '../../features/notifications/slice';
import { toastMiddleware } from './toastMiddleware';
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
      users: usersReducer,
      auditLog: auditLogReducer,
      toast: toastReducer,
      notifications: notificationsReducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        thunk: {
          extraArgument: dependencies,
        },
      }).concat(toastMiddleware),
  });

  // Persist connection settings (IP/port, devices, register offsets) on
  // every change so edits survive a reload. The saved blob does include
  // whatever connection status happened to be current at save time, but
  // slice.ts's loadPersistedState() always resets it back to disconnected
  // on the next load, since the real socket lives in the gateway process,
  // not this store. mailSettings has no local persistence of its own -
  // tms-backend is its source of truth (see mailSettings/slice.ts), fetched
  // fresh via fetchMailSettingsAsync rather than cached in localStorage.
  let previousConnectionSettings = store.getState().connectionSettings;
  store.subscribe(() => {
    const state = store.getState();
    if (state.connectionSettings !== previousConnectionSettings) {
      previousConnectionSettings = state.connectionSettings;
      persistConnectionSettings(state.connectionSettings);
    }
  });

  return store;
}

// Type for the store instance (will be created in main.tsx)
export type AppStore = ReturnType<typeof createStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];

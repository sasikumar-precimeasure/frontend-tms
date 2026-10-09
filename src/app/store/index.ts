import { combineReducers, configureStore } from '@reduxjs/toolkit';
import authReducer, { loginAsync, logout, logoutAsync } from '../../features/auth/slice';
import connectionSettingsReducer from '../../features/connectionSettings/slice';
import { persistConnectionSettings } from '../../features/connectionSettings/slice';
import dashboardReducer from '../../features/dashboard/slice';
import mailSettingsReducer from '../../features/mailSettings/slice';
import usersReducer from '../../features/users/slice';
import auditLogReducer from '../../features/auditLog/slice';
import toastReducer from '../../features/toast/slice';
import notificationsReducer from '../../features/notifications/slice';
import dataLogReducer from '../../features/dataLog/slice';
import monthlyReportReducer from '../../features/monthlyReport/slice';
import readingsPushReducer from '../../features/readingsPush/slice';
import { toastMiddleware } from './toastMiddleware';
import type { Dependencies } from '../dependencies';

const appReducer = combineReducers({
      auth: authReducer,
      connectionSettings: connectionSettingsReducer,
      dashboard: dashboardReducer,
      mailSettings: mailSettingsReducer,
      users: usersReducer,
      auditLog: auditLogReducer,
      toast: toastReducer,
      notifications: notificationsReducer,
      dataLog: dataLogReducer,
      monthlyReport: monthlyReportReducer,
      readingsPush: readingsPushReducer,
});

// Everything loaded for one user (members, roles, audit/data logs, mail
// recipients, monthly report, notifications, ...) is wiped when they log out
// and again when anyone logs in - the store outlives a logout/login in the
// same browser, so otherwise the next user would see the previous user's
// data, including lists their own role doesn't allow. Kept: the login state
// itself (its own reducer handles the action) and the device configuration
// in connectionSettings, which belongs to this PC rather than a user and is
// synced with the gateway service.
const rootReducer: typeof appReducer = (state, action) => {
  if (state && (logoutAsync.fulfilled.match(action) || logout.match(action) || loginAsync.fulfilled.match(action))) {
    return appReducer({ auth: state.auth, connectionSettings: state.connectionSettings } as Parameters<typeof appReducer>[0], action);
  }
  return appReducer(state, action);
};

export interface StoreConfig {
  dependencies: Dependencies;
}

export function createStore(config: StoreConfig) {
  const { dependencies } = config;

  const store = configureStore({
    reducer: rootReducer,
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

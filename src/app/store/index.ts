import { configureStore } from '@reduxjs/toolkit';
import authReducer from '../../features/auth/slice';
import modbusReducer from '../../features/modbus/slice';
import type { Dependencies } from '../dependencies';

export interface StoreConfig {
  dependencies: Dependencies;
}

export function createStore(config: StoreConfig) {
  const { dependencies } = config;

  return configureStore({
    reducer: {
      auth: authReducer,
      modbus: modbusReducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        thunk: {
          extraArgument: dependencies,
        },
      }),
  });
}

// Type for the store instance (will be created in main.tsx)
export type AppStore = ReturnType<typeof createStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];

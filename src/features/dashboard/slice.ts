import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { Dependencies } from '../../app/dependencies';
import { AxiosError } from 'axios';
import { liveSnapshotReceived } from '../live/actions';
import type { RootState } from '../../app/store';
import { hasWritePermission } from '../../shared/hooks/usePermissions';

interface TrReadState {
  registers: number[] | null;
  isReading: boolean;
  errorMessage: string | null;
  lastReadAt: string | null;
}

interface WriteState {
  isWriting: boolean;
  errorMessage: string | null;
}

interface DashboardState {
  readingsByTrId: Record<string, TrReadState>;
  writesByKey: Record<string, WriteState>;
}

const initialState: DashboardState = {
  readingsByTrId: {},
  writesByKey: {},
};

function extractErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const data = error.response?.data as { message?: string } | undefined;
    if (data?.message) return data.message;
  }
  if (error instanceof Error) return error.message;
  return 'An unknown error occurred';
}

// Writes a single register (mirrors ModbusClient.vb WriteSingleRegister / FC06) -
// used by the annunciation panel to acknowledge an alarm on the device itself.
// `menu` is the screen the command comes from - the user needs WRITE
// permission on it (AVR Settings for setpoints written there, Dashboard for
// the dashboard's controls). Checked here so a read-only user's command is
// never sent, and again by the gateway service.
export const writeRegisterAsync = createAsyncThunk<
  { key: string; errorMessage: string | null; isConnected: boolean },
  { key: string; clientId: number; slaveId: number; address: number; value: number; menu?: 'Dashboard' | 'AVR Settings' },
  { extra: Dependencies; state: RootState }
>('dashboard/writeRegister', async (request, { extra, getState, rejectWithValue }) => {
  const menu = request.menu ?? 'Dashboard';
  if (!hasWritePermission(getState().auth.permissions, menu)) {
    return rejectWithValue({ key: request.key, message: `You don't have permission to change ${menu}`, isConnected: true });
  }
  try {
    const modbus = extra.modbus();
    const result = await modbus.writeSingleRegisterUseCase.execute(request);
    return { key: request.key, errorMessage: result.errorMessage, isConnected: result.isConnected };
  } catch (error: unknown) {
    return rejectWithValue({ key: request.key, message: extractErrorMessage(error), isConnected: false });
  }
});

function ensureTrState(state: DashboardState, trId: string): TrReadState {
  if (!state.readingsByTrId[trId]) {
    state.readingsByTrId[trId] = { registers: null, isReading: false, errorMessage: null, lastReadAt: null };
  }
  return state.readingsByTrId[trId];
}

function ensureWriteState(state: DashboardState, key: string): WriteState {
  if (!state.writesByKey[key]) {
    state.writesByKey[key] = { isWriting: false, errorMessage: null };
  }
  return state.writesByKey[key];
}

const dashboardSlice = createSlice({
  name: 'dashboard',
  initialState,
  reducers: {
    clearTrReading: (state, action: PayloadAction<{ trId: string }>) => {
      delete state.readingsByTrId[action.payload.trId];
    },
  },
  extraReducers: (builder) => {
    builder
      // Every device's latest reading, polled by the gateway service (not
      // this tab) - see features/live.
      .addCase(liveSnapshotReceived, (state, action) => {
        for (const [key, live] of Object.entries(action.payload.devicesByReadingKey)) {
          const trState = ensureTrState(state, key);
          trState.isReading = false;
          trState.registers = live.registers;
          trState.errorMessage = live.errorMessage;
          trState.lastReadAt = live.lastReadAt;
        }
      })
      .addCase(writeRegisterAsync.pending, (state, action) => {
        const writeState = ensureWriteState(state, action.meta.arg.key);
        writeState.isWriting = true;
        writeState.errorMessage = null;
      })
      .addCase(writeRegisterAsync.fulfilled, (state, action) => {
        const writeState = ensureWriteState(state, action.payload.key);
        writeState.isWriting = false;
        writeState.errorMessage = action.payload.errorMessage;
      })
      .addCase(writeRegisterAsync.rejected, (state, action) => {
        const payload = action.payload as { key: string; message: string } | undefined;
        const key = payload?.key ?? action.meta.arg.key;
        const writeState = ensureWriteState(state, key);
        writeState.isWriting = false;
        writeState.errorMessage = payload?.message ?? 'Write failed';
      });
  },
});

export const { clearTrReading } = dashboardSlice.actions;
export default dashboardSlice.reducer;

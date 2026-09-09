import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { Dependencies } from '../../app/dependencies';
import { AxiosError } from 'axios';

interface TrReadState {
  registers: number[] | null;
  isReading: boolean;
  errorMessage: string | null;
  lastReadAt: string | null;
}

interface DashboardState {
  readingsByTrId: Record<string, TrReadState>;
}

const initialState: DashboardState = {
  readingsByTrId: {},
};

function extractErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const data = error.response?.data as { message?: string } | undefined;
    if (data?.message) return data.message;
  }
  if (error instanceof Error) return error.message;
  return 'An unknown error occurred';
}

// Reads FC03 holding registers for one TR's linked gateway/slave (mirrors
// ModbusClient.vb ReadRegisters); each TR panel polls this independently.
export const readTransformerRegistersAsync = createAsyncThunk<
  { trId: string; registers: number[] | null; errorMessage: string | null },
  { trId: string; clientId: number; slaveId: number; startAddress: number; count: number },
  { extra: Dependencies }
>('dashboard/readTransformerRegisters', async (request, { extra, rejectWithValue }) => {
  try {
    const modbus = extra.modbus();
    const result = await modbus.readHoldingRegistersUseCase.execute(request);
    return { trId: request.trId, registers: result.registers, errorMessage: result.errorMessage };
  } catch (error: unknown) {
    return rejectWithValue({ trId: request.trId, message: extractErrorMessage(error) });
  }
});

function ensureTrState(state: DashboardState, trId: string): TrReadState {
  if (!state.readingsByTrId[trId]) {
    state.readingsByTrId[trId] = { registers: null, isReading: false, errorMessage: null, lastReadAt: null };
  }
  return state.readingsByTrId[trId];
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
      .addCase(readTransformerRegistersAsync.pending, (state, action) => {
        ensureTrState(state, action.meta.arg.trId).isReading = true;
      })
      .addCase(readTransformerRegistersAsync.fulfilled, (state, action) => {
        const trState = ensureTrState(state, action.payload.trId);
        trState.isReading = false;
        trState.registers = action.payload.registers;
        trState.errorMessage = action.payload.errorMessage;
        trState.lastReadAt = new Date().toISOString();
      })
      .addCase(readTransformerRegistersAsync.rejected, (state, action) => {
        const payload = action.payload as { trId: string; message: string } | undefined;
        const trId = payload?.trId ?? action.meta.arg.trId;
        const trState = ensureTrState(state, trId);
        trState.isReading = false;
        trState.errorMessage = payload?.message ?? 'Read failed';
        trState.lastReadAt = new Date().toISOString();
      });
  },
});

export const { clearTrReading } = dashboardSlice.actions;
export default dashboardSlice.reducer;

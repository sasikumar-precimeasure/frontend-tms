import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { ModbusConnection, ModbusReadResult } from '../../domain/entities/Modbus';
import type { Dependencies } from '../../app/dependencies';
import { AxiosError } from 'axios';

export interface ModbusLogEntry {
  id: string;
  timestamp: string;
  operation: 'connect' | 'disconnect';
  endpoint: string;
  request: unknown;
  response: unknown | null;
  errorMessage: string | null;
}

interface ModbusState {
  clientId: number | null;
  ipAddress: string;
  port: number;
  status: ModbusConnection['status'];
  isConnected: boolean;
  isConnecting: boolean;
  isDisconnecting: boolean;
  error: string | null;
  logs: ModbusLogEntry[];
  // -- FC03: Read Holding Registers (polled every 1s while connected) --
  registers: number[] | null;
  isReading: boolean;
  readError: string | null;
  lastReadAt: string | null;
}

const MAX_LOG_ENTRIES = 20;

const initialState: ModbusState = {
  clientId: null,
  ipAddress: '',
  port: 502, // MODBUS_PORT default, matches ModbusClient.vb
  status: 'disconnected',
  isConnected: false,
  isConnecting: false,
  isDisconnecting: false,
  error: null,
  logs: [],
  registers: null,
  isReading: false,
  readError: null,
  lastReadAt: null,
};

function pushLog(state: ModbusState, entry: ModbusLogEntry) {
  state.logs.unshift(entry);
  if (state.logs.length > MAX_LOG_ENTRIES) state.logs.length = MAX_LOG_ENTRIES;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const data = error.response?.data as { message?: string } | undefined;
    if (data?.message) return data.message;
  }
  if (error instanceof Error) return error.message;
  return 'An unknown error occurred';
}

// -- Connect -- (mirrors ModbusClient.vb Connect(ipAddress, port))
export const connectModbusAsync = createAsyncThunk<
  ModbusConnection,
  { clientId: number; ipAddress: string; port: number },
  { extra: Dependencies }
>('modbus/connect', async (request, { extra, rejectWithValue }) => {
  try {
    const modbus = extra.modbus();
    return await modbus.connectModbusUseCase.execute(request);
  } catch (error: unknown) {
    return rejectWithValue(extractErrorMessage(error));
  }
});

// -- Disconnect -- (mirrors ModbusClient.vb Disconnect())
export const disconnectModbusAsync = createAsyncThunk<
  ModbusConnection,
  { clientId: number },
  { extra: Dependencies }
>('modbus/disconnect', async (request, { extra, rejectWithValue }) => {
  try {
    const modbus = extra.modbus();
    return await modbus.disconnectModbusUseCase.execute(request);
  } catch (error: unknown) {
    return rejectWithValue(extractErrorMessage(error));
  }
});

// -- FC03: Read Holding Registers -- (mirrors ModbusClient.vb ReadRegisters)
export const readHoldingRegistersAsync = createAsyncThunk<
  ModbusReadResult,
  { clientId: number; slaveId: number; startAddress: number; count: number },
  { extra: Dependencies }
>('modbus/readHoldingRegisters', async (request, { extra, rejectWithValue }) => {
  try {
    const modbus = extra.modbus();
    return await modbus.readHoldingRegistersUseCase.execute(request);
  } catch (error: unknown) {
    return rejectWithValue(extractErrorMessage(error));
  }
});

const modbusSlice = createSlice({
  name: 'modbus',
  initialState,
  reducers: {
    clearModbusError: (state) => {
      state.error = null;
    },
    clearModbusLogs: (state) => {
      state.logs = [];
    },
  },
  extraReducers: (builder) => {
    builder
      // -- Connect --
      .addCase(connectModbusAsync.pending, (state, action) => {
        state.isConnecting = true;
        state.status = 'connecting';
        state.error = null;
        state.ipAddress = action.meta.arg.ipAddress;
        state.port = action.meta.arg.port;
        pushLog(state, {
          id: action.meta.requestId,
          timestamp: new Date().toISOString(),
          operation: 'connect',
          endpoint: 'ModbusClient.connect()',
          request: action.meta.arg,
          response: null,
          errorMessage: null,
        });
      })
      .addCase(connectModbusAsync.fulfilled, (state, action) => {
        state.isConnecting = false;
        state.clientId = action.payload.clientId;
        state.ipAddress = action.payload.ipAddress;
        state.port = action.payload.port;
        state.status = action.payload.status;
        state.isConnected = action.payload.isConnected;
        state.error = action.payload.errorMessage;
        const log = state.logs.find((l) => l.id === action.meta.requestId);
        if (log) log.response = action.payload;
      })
      .addCase(connectModbusAsync.rejected, (state, action) => {
        state.isConnecting = false;
        state.status = 'error';
        state.isConnected = false;
        state.error = action.payload as string;
        const log = state.logs.find((l) => l.id === action.meta.requestId);
        if (log) log.errorMessage = action.payload as string;
      })

      // -- Disconnect --
      .addCase(disconnectModbusAsync.pending, (state, action) => {
        state.isDisconnecting = true;
        state.error = null;
        pushLog(state, {
          id: action.meta.requestId,
          timestamp: new Date().toISOString(),
          operation: 'disconnect',
          endpoint: 'ModbusClient.disconnect()',
          request: action.meta.arg,
          response: null,
          errorMessage: null,
        });
      })
      .addCase(disconnectModbusAsync.fulfilled, (state, action) => {
        state.isDisconnecting = false;
        state.status = action.payload.status;
        state.isConnected = action.payload.isConnected;
        state.error = action.payload.errorMessage;
        state.registers = null;
        state.readError = null;
        state.lastReadAt = null;
        const log = state.logs.find((l) => l.id === action.meta.requestId);
        if (log) log.response = action.payload;
      })
      .addCase(disconnectModbusAsync.rejected, (state, action) => {
        state.isDisconnecting = false;
        state.error = action.payload as string;
        const log = state.logs.find((l) => l.id === action.meta.requestId);
        if (log) log.errorMessage = action.payload as string;
      })

      // -- Read Holding Registers (FC03) --
      .addCase(readHoldingRegistersAsync.pending, (state) => {
        state.isReading = true;
      })
      .addCase(readHoldingRegistersAsync.fulfilled, (state, action) => {
        state.isReading = false;
        state.registers = action.payload.registers;
        state.readError = action.payload.errorMessage;
        state.lastReadAt = new Date().toISOString();
      })
      .addCase(readHoldingRegistersAsync.rejected, (state, action) => {
        state.isReading = false;
        state.readError = action.payload as string;
        state.lastReadAt = new Date().toISOString();
      });
  },
});

export const { clearModbusError, clearModbusLogs } = modbusSlice.actions;
export default modbusSlice.reducer;

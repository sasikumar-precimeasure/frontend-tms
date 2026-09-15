import { createSlice, createAsyncThunk, nanoid } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { Transformer, SubDevice } from '../../domain/entities/ConnectionSettings';
import type { RegisterOffsetMap } from '../../domain/entities/TransformerRegisterMap';
import { DEFAULT_REGISTER_CONFIG } from '../../domain/entities/TransformerRegisterMap';
import type { Dependencies } from '../../app/dependencies';
import { AxiosError } from 'axios';

function cloneDefaultRegisterConfig() {
  return {
    startAddress: DEFAULT_REGISTER_CONFIG.startAddress,
    count: DEFAULT_REGISTER_CONFIG.count,
    offsets: { ...DEFAULT_REGISTER_CONFIG.offsets },
  };
}

interface ConnectionSettingsState {
  selectedTrId: string;
  transformers: Transformer[];
  nextClientId: number;
}

const PERSIST_KEY = 'tms-connection-settings';

type PersistedState = Pick<ConnectionSettingsState, 'transformers' | 'selectedTrId' | 'nextClientId'>;

// Live connection state belongs to the gateway's real TCP socket, not this
// JSON blob - always reset it on load so a persisted "connected" from a
// previous session never lies about the actual socket state.
function resetLiveConnectionFields(transformers: Transformer[]): Transformer[] {
  return transformers.map((tr) => ({
    ...tr,
    status: 'disconnected',
    isConnected: false,
    isConnecting: false,
    errorMessage: null,
  }));
}

function loadPersistedState(): PersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (!Array.isArray(parsed.transformers) || parsed.transformers.length === 0) return null;
    return {
      transformers: resetLiveConnectionFields(parsed.transformers as Transformer[]),
      selectedTrId: typeof parsed.selectedTrId === 'string' ? parsed.selectedTrId : parsed.transformers[0].id,
      nextClientId: typeof parsed.nextClientId === 'number' ? parsed.nextClientId : parsed.transformers.length + 1,
    };
  } catch {
    // Corrupt/stale localStorage content - fall back to defaults rather
    // than crashing the app on load.
    return null;
  }
}

export function persistConnectionSettings(state: ConnectionSettingsState): void {
  if (typeof window === 'undefined') return;
  const payload: PersistedState = {
    transformers: state.transformers,
    selectedTrId: state.selectedTrId,
    nextClientId: state.nextClientId,
  };
  try {
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify(payload));
  } catch {
    // Storage full/unavailable (private browsing, quota) - settings just
    // won't persist this session; not worth surfacing to the user.
  }
}

function makeDefaultState(): Pick<ConnectionSettingsState, 'transformers' | 'selectedTrId'> {
  const transformers: Transformer[] = [
    {
      id: nanoid(),
      clientId: 1,
      name: 'TR1 7.5 MVA',
      ipAddress: '192.168.65.100',
      port: 502,
      status: 'disconnected',
      isConnected: false,
      isConnecting: false,
      errorMessage: null,
      subDevices: [
        { id: nanoid(), name: 'TR1 7.5 MVA IRTCC', enabled: true, slaveId: 1, registerConfig: cloneDefaultRegisterConfig() },
        { id: nanoid(), name: 'TR1 7.5 MVA 2243', enabled: true, slaveId: 11, registerConfig: cloneDefaultRegisterConfig() },
        { id: nanoid(), name: 'TR 1 Smart Breather', enabled: false, slaveId: 5, registerConfig: cloneDefaultRegisterConfig() },
      ],
    },
    {
      id: nanoid(),
      clientId: 2,
      name: 'TR2 7.5 MVA',
      ipAddress: '192.168.65.252',
      port: 502,
      status: 'disconnected',
      isConnected: false,
      isConnecting: false,
      errorMessage: null,
      subDevices: [
        { id: nanoid(), name: 'TR2 7.5 MVA IRTCC', enabled: true, slaveId: 2, registerConfig: cloneDefaultRegisterConfig() },
        { id: nanoid(), name: 'TR2 7.5 MVA 2243', enabled: true, slaveId: 22, registerConfig: cloneDefaultRegisterConfig() },
      ],
    },
  ];

  return { transformers, selectedTrId: transformers[0].id };
}

const persisted = loadPersistedState();

const initialState: ConnectionSettingsState = persisted ?? {
  ...makeDefaultState(),
  nextClientId: 3,
};

function extractErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const data = error.response?.data as { message?: string } | undefined;
    if (data?.message) return data.message;
  }
  if (error instanceof Error) return error.message;
  return 'An unknown error occurred';
}

// -- Connect a transformer's own connection -- (mirrors ModbusClient.vb Connect(ipAddress, port))
export const connectTransformerAsync = createAsyncThunk<
  { trId: string; clientId: number; status: string; isConnected: boolean; errorMessage: string | null },
  { trId: string; clientId: number; ipAddress: string; port: number },
  { extra: Dependencies }
>('connectionSettings/connectTransformer', async (request, { extra, rejectWithValue }) => {
  try {
    const modbus = extra.modbus();
    const result = await modbus.connectModbusUseCase.execute({
      clientId: request.clientId,
      ipAddress: request.ipAddress,
      port: request.port,
    });
    return {
      trId: request.trId,
      clientId: result.clientId,
      status: result.status,
      isConnected: result.isConnected,
      errorMessage: result.errorMessage,
    };
  } catch (error: unknown) {
    return rejectWithValue({ trId: request.trId, message: extractErrorMessage(error) });
  }
});

// -- Disconnect a transformer's own connection -- (mirrors ModbusClient.vb Disconnect())
export const disconnectTransformerAsync = createAsyncThunk<
  { trId: string; status: string; isConnected: boolean },
  { trId: string; clientId: number },
  { extra: Dependencies }
>('connectionSettings/disconnectTransformer', async (request, { extra }) => {
  const modbus = extra.modbus();
  const result = await modbus.disconnectModbusUseCase.execute({ clientId: request.clientId });
  return { trId: request.trId, status: result.status, isConnected: result.isConnected };
});

const connectionSettingsSlice = createSlice({
  name: 'connectionSettings',
  initialState,
  reducers: {
    selectTr: (state, action: PayloadAction<string>) => {
      state.selectedTrId = action.payload;
    },
    addTransformer: (state) => {
      const clientId = state.nextClientId;
      state.nextClientId += 1;
      const newTr: Transformer = {
        id: nanoid(),
        clientId,
        name: `TR${state.transformers.length + 1}`,
        ipAddress: '',
        port: 502,
        status: 'disconnected',
        isConnected: false,
        isConnecting: false,
        errorMessage: null,
        subDevices: [],
      };
      state.transformers.push(newTr);
      state.selectedTrId = newTr.id;
    },
    removeTransformer: (state, action: PayloadAction<{ trId: string }>) => {
      state.transformers = state.transformers.filter((tr) => tr.id !== action.payload.trId);
      if (state.selectedTrId === action.payload.trId) {
        state.selectedTrId = state.transformers[0]?.id ?? '';
      }
    },
    renameTransformer: (state, action: PayloadAction<{ trId: string; name: string }>) => {
      const tr = state.transformers.find((t) => t.id === action.payload.trId);
      if (tr) tr.name = action.payload.name;
    },
    updateTransformerConnection: (
      state,
      action: PayloadAction<{ trId: string; ipAddress: string; port: number }>
    ) => {
      const tr = state.transformers.find((t) => t.id === action.payload.trId);
      if (tr) {
        tr.ipAddress = action.payload.ipAddress;
        tr.port = action.payload.port;
      }
    },
    clearTransformerError: (state, action: PayloadAction<{ trId: string }>) => {
      const tr = state.transformers.find((t) => t.id === action.payload.trId);
      if (tr) tr.errorMessage = null;
    },
    addSubDevice: (state, action: PayloadAction<{ trId: string }>) => {
      const tr = state.transformers.find((t) => t.id === action.payload.trId);
      if (tr) {
        const newDevice: SubDevice = {
          id: nanoid(),
          name: 'New Device',
          enabled: true,
          slaveId: 1,
          registerConfig: cloneDefaultRegisterConfig(),
        };
        tr.subDevices.push(newDevice);
      }
    },
    removeSubDevice: (state, action: PayloadAction<{ trId: string; deviceId: string }>) => {
      const tr = state.transformers.find((t) => t.id === action.payload.trId);
      if (tr) {
        tr.subDevices = tr.subDevices.filter((d) => d.id !== action.payload.deviceId);
      }
    },
    updateSubDeviceField: (
      state,
      action: PayloadAction<{ trId: string; deviceId: string; field: 'name'; value: string }>
    ) => {
      const tr = state.transformers.find((t) => t.id === action.payload.trId);
      const device = tr?.subDevices.find((d) => d.id === action.payload.deviceId);
      if (device) device[action.payload.field] = action.payload.value;
    },
    updateSubDeviceSlaveId: (
      state,
      action: PayloadAction<{ trId: string; deviceId: string; slaveId: number }>
    ) => {
      const tr = state.transformers.find((t) => t.id === action.payload.trId);
      const device = tr?.subDevices.find((d) => d.id === action.payload.deviceId);
      if (device) device.slaveId = action.payload.slaveId;
    },
    toggleSubDeviceEnabled: (state, action: PayloadAction<{ trId: string; deviceId: string }>) => {
      const tr = state.transformers.find((t) => t.id === action.payload.trId);
      const device = tr?.subDevices.find((d) => d.id === action.payload.deviceId);
      if (device) device.enabled = !device.enabled;
    },
    updateSubDeviceReadConfig: (
      state,
      action: PayloadAction<{ trId: string; deviceId: string; startAddress: number; count: number }>
    ) => {
      const tr = state.transformers.find((t) => t.id === action.payload.trId);
      const device = tr?.subDevices.find((d) => d.id === action.payload.deviceId);
      if (device) {
        device.registerConfig.startAddress = action.payload.startAddress;
        device.registerConfig.count = action.payload.count;
      }
    },
    updateSubDeviceRegisterOffset: (
      state,
      action: PayloadAction<{ trId: string; deviceId: string; field: keyof RegisterOffsetMap; offset: number }>
    ) => {
      const tr = state.transformers.find((t) => t.id === action.payload.trId);
      const device = tr?.subDevices.find((d) => d.id === action.payload.deviceId);
      if (device) {
        device.registerConfig.offsets[action.payload.field] = action.payload.offset;
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(connectTransformerAsync.pending, (state, action) => {
        const tr = state.transformers.find((t) => t.id === action.meta.arg.trId);
        if (tr) {
          tr.isConnecting = true;
          tr.status = 'connecting';
          tr.errorMessage = null;
        }
      })
      .addCase(connectTransformerAsync.fulfilled, (state, action) => {
        const tr = state.transformers.find((t) => t.id === action.payload.trId);
        if (tr) {
          tr.isConnecting = false;
          tr.status = action.payload.status as Transformer['status'];
          tr.isConnected = action.payload.isConnected;
          tr.errorMessage = action.payload.errorMessage;
        }
      })
      .addCase(connectTransformerAsync.rejected, (state, action) => {
        const payload = action.payload as { trId: string; message: string } | undefined;
        const trId = payload?.trId ?? action.meta.arg.trId;
        const tr = state.transformers.find((t) => t.id === trId);
        if (tr) {
          tr.isConnecting = false;
          tr.status = 'error';
          tr.isConnected = false;
          tr.errorMessage = payload?.message ?? 'Connection failed';
        }
      })
      .addCase(disconnectTransformerAsync.fulfilled, (state, action) => {
        const tr = state.transformers.find((t) => t.id === action.payload.trId);
        if (tr) {
          tr.status = action.payload.status as Transformer['status'];
          tr.isConnected = action.payload.isConnected;
          tr.errorMessage = null;
        }
      });
  },
});

export const {
  selectTr,
  addTransformer,
  removeTransformer,
  renameTransformer,
  updateTransformerConnection,
  clearTransformerError,
  addSubDevice,
  removeSubDevice,
  updateSubDeviceField,
  updateSubDeviceSlaveId,
  toggleSubDeviceEnabled,
  updateSubDeviceReadConfig,
  updateSubDeviceRegisterOffset,
} = connectionSettingsSlice.actions;
export default connectionSettingsSlice.reducer;

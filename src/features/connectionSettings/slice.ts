import { createSlice, createAsyncThunk, nanoid } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { Gateway, SubDevice, Transformer } from '../../domain/entities/ConnectionSettings';
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
  gateways: Gateway[];
  nextClientId: number;
}

function makeDefaultState(): Pick<ConnectionSettingsState, 'gateways' | 'transformers' | 'selectedTrId'> {
  const gateway1Id = nanoid();
  const gateway2Id = nanoid();
  const tr1IrtccId = nanoid();
  const tr2IrtccId = nanoid();

  const gateways: Gateway[] = [
    {
      id: gateway1Id,
      clientId: 1,
      label: 'Ethernet IP',
      ipAddress: '192.168.65.100',
      port: 502,
      status: 'disconnected',
      isConnected: false,
      isConnecting: false,
      errorMessage: null,
      subDevices: [
        { id: tr1IrtccId, name: 'TR1 7.5 MVA IRTCC', enabled: true, slaveId: 1 },
        { id: nanoid(), name: 'TR1 7.5 MVA 2243', enabled: true, slaveId: 11 },
        { id: nanoid(), name: 'TR 1 Smart Breather', enabled: false, slaveId: 5 },
      ],
    },
    {
      id: gateway2Id,
      clientId: 2,
      label: '2280-2 IP',
      ipAddress: '192.168.65.252',
      port: 502,
      status: 'disconnected',
      isConnected: false,
      isConnecting: false,
      errorMessage: null,
      subDevices: [
        { id: tr2IrtccId, name: 'TR2 7.5 MVA IRTCC', enabled: true, slaveId: 2 },
        { id: nanoid(), name: 'TR2 7.5 MVA 2243', enabled: true, slaveId: 22 },
      ],
    },
  ];

  const transformers: Transformer[] = [
    {
      id: nanoid(),
      name: 'TR1 7.5 MVA',
      linkedGatewayId: gateway1Id,
      linkedSubDeviceId: tr1IrtccId,
      registerConfig: cloneDefaultRegisterConfig(),
    },
    {
      id: nanoid(),
      name: 'TR2 7.5 MVA',
      linkedGatewayId: gateway2Id,
      linkedSubDeviceId: tr2IrtccId,
      registerConfig: cloneDefaultRegisterConfig(),
    },
  ];

  return { gateways, transformers, selectedTrId: transformers[0].id };
}

const initialState: ConnectionSettingsState = {
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

// -- Connect a gateway -- (mirrors ModbusClient.vb Connect(ipAddress, port))
export const connectGatewayAsync = createAsyncThunk<
  { gatewayId: string; clientId: number; status: string; isConnected: boolean; errorMessage: string | null },
  { gatewayId: string; clientId: number; ipAddress: string; port: number },
  { extra: Dependencies }
>('connectionSettings/connectGateway', async (request, { extra, rejectWithValue }) => {
  try {
    const modbus = extra.modbus();
    const result = await modbus.connectModbusUseCase.execute({
      clientId: request.clientId,
      ipAddress: request.ipAddress,
      port: request.port,
    });
    return {
      gatewayId: request.gatewayId,
      clientId: result.clientId,
      status: result.status,
      isConnected: result.isConnected,
      errorMessage: result.errorMessage,
    };
  } catch (error: unknown) {
    return rejectWithValue({ gatewayId: request.gatewayId, message: extractErrorMessage(error) });
  }
});

// -- Disconnect a gateway -- (mirrors ModbusClient.vb Disconnect())
export const disconnectGatewayAsync = createAsyncThunk<
  { gatewayId: string; status: string; isConnected: boolean },
  { gatewayId: string; clientId: number },
  { extra: Dependencies }
>('connectionSettings/disconnectGateway', async (request, { extra }) => {
  const modbus = extra.modbus();
  const result = await modbus.disconnectModbusUseCase.execute({ clientId: request.clientId });
  return { gatewayId: request.gatewayId, status: result.status, isConnected: result.isConnected };
});

const connectionSettingsSlice = createSlice({
  name: 'connectionSettings',
  initialState,
  reducers: {
    selectTr: (state, action: PayloadAction<string>) => {
      state.selectedTrId = action.payload;
    },
    addTransformer: (state) => {
      const newTr: Transformer = {
        id: nanoid(),
        name: `TR${state.transformers.length + 1}`,
        linkedGatewayId: null,
        linkedSubDeviceId: null,
        registerConfig: cloneDefaultRegisterConfig(),
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
    linkTransformer: (
      state,
      action: PayloadAction<{ trId: string; gatewayId: string | null; subDeviceId: string | null }>
    ) => {
      const tr = state.transformers.find((t) => t.id === action.payload.trId);
      if (tr) {
        tr.linkedGatewayId = action.payload.gatewayId;
        tr.linkedSubDeviceId = action.payload.subDeviceId;
      }
    },
    updateTransformerReadConfig: (
      state,
      action: PayloadAction<{ trId: string; startAddress: number; count: number }>
    ) => {
      const tr = state.transformers.find((t) => t.id === action.payload.trId);
      if (tr) {
        tr.registerConfig.startAddress = action.payload.startAddress;
        tr.registerConfig.count = action.payload.count;
      }
    },
    updateTransformerRegisterOffset: (
      state,
      action: PayloadAction<{ trId: string; field: keyof RegisterOffsetMap; offset: number }>
    ) => {
      const tr = state.transformers.find((t) => t.id === action.payload.trId);
      if (tr) {
        tr.registerConfig.offsets[action.payload.field] = action.payload.offset;
      }
    },
    addGateway: (state) => {
      const clientId = state.nextClientId;
      state.nextClientId += 1;
      state.gateways.push({
        id: nanoid(),
        clientId,
        label: `Gateway ${clientId}`,
        ipAddress: '',
        port: 502,
        status: 'disconnected',
        isConnected: false,
        isConnecting: false,
        errorMessage: null,
        subDevices: [],
      });
    },
    removeGateway: (state, action: PayloadAction<{ gatewayId: string }>) => {
      state.gateways = state.gateways.filter((g) => g.id !== action.payload.gatewayId);
      state.transformers.forEach((tr) => {
        if (tr.linkedGatewayId === action.payload.gatewayId) {
          tr.linkedGatewayId = null;
          tr.linkedSubDeviceId = null;
        }
      });
    },
    updateGatewayField: (
      state,
      action: PayloadAction<{ gatewayId: string; field: 'label' | 'ipAddress'; value: string }>
    ) => {
      const gateway = state.gateways.find((g) => g.id === action.payload.gatewayId);
      if (gateway) gateway[action.payload.field] = action.payload.value;
    },
    updateGatewayPort: (state, action: PayloadAction<{ gatewayId: string; port: number }>) => {
      const gateway = state.gateways.find((g) => g.id === action.payload.gatewayId);
      if (gateway) gateway.port = action.payload.port;
    },
    addSubDevice: (state, action: PayloadAction<{ gatewayId: string }>) => {
      const gateway = state.gateways.find((g) => g.id === action.payload.gatewayId);
      if (gateway) {
        const newDevice: SubDevice = { id: nanoid(), name: 'New Device', enabled: true, slaveId: 1 };
        gateway.subDevices.push(newDevice);
      }
    },
    removeSubDevice: (state, action: PayloadAction<{ gatewayId: string; deviceId: string }>) => {
      const gateway = state.gateways.find((g) => g.id === action.payload.gatewayId);
      if (gateway) {
        gateway.subDevices = gateway.subDevices.filter((d) => d.id !== action.payload.deviceId);
      }
      state.transformers.forEach((tr) => {
        if (tr.linkedSubDeviceId === action.payload.deviceId) {
          tr.linkedGatewayId = null;
          tr.linkedSubDeviceId = null;
        }
      });
    },
    updateSubDeviceField: (
      state,
      action: PayloadAction<{ gatewayId: string; deviceId: string; field: 'name'; value: string }>
    ) => {
      const gateway = state.gateways.find((g) => g.id === action.payload.gatewayId);
      const device = gateway?.subDevices.find((d) => d.id === action.payload.deviceId);
      if (device) device[action.payload.field] = action.payload.value;
    },
    updateSubDeviceSlaveId: (
      state,
      action: PayloadAction<{ gatewayId: string; deviceId: string; slaveId: number }>
    ) => {
      const gateway = state.gateways.find((g) => g.id === action.payload.gatewayId);
      const device = gateway?.subDevices.find((d) => d.id === action.payload.deviceId);
      if (device) device.slaveId = action.payload.slaveId;
    },
    toggleSubDeviceEnabled: (state, action: PayloadAction<{ gatewayId: string; deviceId: string }>) => {
      const gateway = state.gateways.find((g) => g.id === action.payload.gatewayId);
      const device = gateway?.subDevices.find((d) => d.id === action.payload.deviceId);
      if (device) device.enabled = !device.enabled;
    },
    clearGatewayError: (state, action: PayloadAction<{ gatewayId: string }>) => {
      const gateway = state.gateways.find((g) => g.id === action.payload.gatewayId);
      if (gateway) gateway.errorMessage = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(connectGatewayAsync.pending, (state, action) => {
        const gateway = state.gateways.find((g) => g.id === action.meta.arg.gatewayId);
        if (gateway) {
          gateway.isConnecting = true;
          gateway.status = 'connecting';
          gateway.errorMessage = null;
        }
      })
      .addCase(connectGatewayAsync.fulfilled, (state, action) => {
        const gateway = state.gateways.find((g) => g.id === action.payload.gatewayId);
        if (gateway) {
          gateway.isConnecting = false;
          gateway.status = action.payload.status as Gateway['status'];
          gateway.isConnected = action.payload.isConnected;
          gateway.errorMessage = action.payload.errorMessage;
        }
      })
      .addCase(connectGatewayAsync.rejected, (state, action) => {
        const payload = action.payload as { gatewayId: string; message: string } | undefined;
        const gatewayId = payload?.gatewayId ?? action.meta.arg.gatewayId;
        const gateway = state.gateways.find((g) => g.id === gatewayId);
        if (gateway) {
          gateway.isConnecting = false;
          gateway.status = 'error';
          gateway.isConnected = false;
          gateway.errorMessage = payload?.message ?? 'Connection failed';
        }
      })
      .addCase(disconnectGatewayAsync.fulfilled, (state, action) => {
        const gateway = state.gateways.find((g) => g.id === action.payload.gatewayId);
        if (gateway) {
          gateway.status = action.payload.status as Gateway['status'];
          gateway.isConnected = action.payload.isConnected;
          gateway.errorMessage = null;
        }
      });
  },
});

export const {
  selectTr,
  addTransformer,
  removeTransformer,
  renameTransformer,
  linkTransformer,
  addGateway,
  removeGateway,
  updateGatewayField,
  updateGatewayPort,
  addSubDevice,
  removeSubDevice,
  updateSubDeviceField,
  updateSubDeviceSlaveId,
  toggleSubDeviceEnabled,
  clearGatewayError,
  updateTransformerReadConfig,
  updateTransformerRegisterOffset,
} = connectionSettingsSlice.actions;
export default connectionSettingsSlice.reducer;

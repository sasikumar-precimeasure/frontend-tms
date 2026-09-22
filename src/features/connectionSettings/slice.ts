import { createSlice, createAsyncThunk, nanoid } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { DeviceType, Transformer, Gateway, SubDevice } from '../../domain/entities/ConnectionSettings';
import type { RegisterOffsetMap } from '../../domain/entities/TransformerRegisterMap';
import { DEFAULT_REGISTER_CONFIG } from '../../domain/entities/TransformerRegisterMap';
import type { Device2243OffsetMap } from '../../domain/entities/Device2243RegisterMap';
import { DEFAULT_2243_REGISTER_CONFIG } from '../../domain/entities/Device2243RegisterMap';
import type { MailThresholds } from '../../domain/entities/MailSettings';
import { DEFAULT_MAIL_THRESHOLDS } from '../../domain/entities/MailSettings';
import type { Dependencies } from '../../app/dependencies';
import { AxiosError } from 'axios';
import { readTransformerRegistersAsync, writeRegisterAsync } from '../dashboard/slice';

function cloneDefaultRegisterConfig() {
  return {
    startAddress: DEFAULT_REGISTER_CONFIG.startAddress,
    count: DEFAULT_REGISTER_CONFIG.count,
    offsets: { ...DEFAULT_REGISTER_CONFIG.offsets },
  };
}

function cloneDefault2243RegisterConfig() {
  return {
    startAddress: DEFAULT_2243_REGISTER_CONFIG.startAddress,
    count: DEFAULT_2243_REGISTER_CONFIG.count,
    offsets: { ...DEFAULT_2243_REGISTER_CONFIG.offsets },
  };
}

function makeRegisterConfigForType(deviceType: DeviceType) {
  return deviceType === '2243' ? cloneDefault2243RegisterConfig() : cloneDefaultRegisterConfig();
}

function cloneDefaultMailThresholds(): MailThresholds {
  return { ...DEFAULT_MAIL_THRESHOLDS };
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
    gateways: tr.gateways.map((gw) => ({
      ...gw,
      status: 'disconnected' as const,
      isConnected: false,
      isConnecting: false,
      errorMessage: null,
    })),
  }));
}

// One-time migration for state saved before the Gateway layer existed: back
// then a Transformer owned its connection (ipAddress/port/clientId) and
// subDevices directly. Detected by the absence of `gateways` (old shape has
// `ipAddress` on the TR itself) - wraps that single connection's worth of
// data into one Gateway so existing IP/port/clientId/devices survive
// untouched. Runs on every load (cheap, idempotent) rather than a versioned
// persist key.
interface LegacyTransformerShape {
  id: string;
  name: string;
  clientId?: number;
  ipAddress?: string;
  port?: number;
  status?: string;
  isConnected?: boolean;
  isConnecting?: boolean;
  errorMessage?: string | null;
  subDevices?: SubDevice[];
  gateways?: Gateway[];
}

function migrateToGateways(raw: LegacyTransformerShape[]): Transformer[] {
  return raw.map((tr) => {
    if (Array.isArray(tr.gateways)) {
      return { id: tr.id, name: tr.name, gateways: tr.gateways };
    }
    const gateway: Gateway = {
      id: nanoid(),
      name: 'Gateway 1',
      clientId: tr.clientId ?? 1,
      ipAddress: tr.ipAddress ?? '',
      port: tr.port ?? 502,
      status: 'disconnected',
      isConnected: false,
      isConnecting: false,
      errorMessage: null,
      subDevices: tr.subDevices ?? [],
    };
    return { id: tr.id, name: tr.name, gateways: [gateway] };
  });
}

// One-time migration for state saved before deviceType/Device2243RegisterMap
// existed: back then every sub-device (including ones named "... 2243")
// used IRTCC's register shape - a real bug fixed alongside this migration.
// Since old-shape data can't be told apart from a genuine IRTCC device by
// its registerConfig alone (both look IRTCC-shaped), fall back to the name
// containing "2243" (matching this app's own seed-data naming convention)
// to decide which devices should be corrected to a fresh 2243 config.
// Runs on every load (cheap, idempotent) rather than a versioned persist
// key, so existing IPs/ports/names/other devices are preserved - only the
// wrong-shaped register config is replaced.
function migrateSubDevices(transformers: Transformer[]): Transformer[] {
  return transformers.map((tr) => ({
    ...tr,
    gateways: tr.gateways.map((gw) => ({
      ...gw,
      subDevices: gw.subDevices.map((device) => {
        const offsets = device.registerConfig?.offsets as unknown as Record<string, unknown> | undefined;
        const alreadyShaped2243 = offsets ? 'otiAlarmSetpoint' in offsets : false;
        const nameSuggests2243 = /2243/.test(device.name);

        if (device.deviceType === '2243' && alreadyShaped2243) {
          return device; // already correct, nothing to migrate
        }
        if (device.deviceType !== '2243' && !nameSuggests2243 && device.deviceType) {
          return device; // a real, already-typed IRTCC (or other) device
        }

        const correctedType: DeviceType = device.deviceType === '2243' || nameSuggests2243 ? '2243' : 'irtcc';
        const needsFreshConfig = correctedType === '2243' ? !alreadyShaped2243 : false;
        return {
          ...device,
          deviceType: correctedType,
          registerConfig:
            needsFreshConfig || !device.deviceType ? makeRegisterConfigForType(correctedType) : device.registerConfig,
        };
      }),
    })),
  }));
}

// One-time migration for state saved before a field was added to
// RegisterOffsetMap (e.g. the AVR Settings fields added this session) - an
// IRTCC device persisted before that point has no key for the new field at
// all, so `offsets[newField]` reads back `undefined` and a write computes
// `startAddress + undefined` = NaN/null, sending a malformed FC06 request
// (this is the actual bug behind "avr setting address not using": the
// write's `address` field came through as literal `null`). Backfills any
// offset key missing from a persisted device from DEFAULT_REGISTER_CONFIG,
// without touching keys that already exist (so a user's own edited offsets
// are never overwritten) - and bumps `count` up if it's too small to cover
// the newly-added offsets, since a smaller persisted count would silently
// truncate the read before it ever reaches them.
function migrateIrtccOffsets(transformers: Transformer[]): Transformer[] {
  return transformers.map((tr) => ({
    ...tr,
    gateways: tr.gateways.map((gw) => ({
      ...gw,
      subDevices: gw.subDevices.map((device) => {
        if (device.deviceType !== 'irtcc') return device;
        const offsets = device.registerConfig.offsets as unknown as Record<string, number>;
        const defaults = DEFAULT_REGISTER_CONFIG.offsets as unknown as Record<string, number>;
        const missingKeys = Object.keys(defaults).filter((key) => !(key in offsets));
        const needsCountBump = device.registerConfig.count < DEFAULT_REGISTER_CONFIG.count;
        if (missingKeys.length === 0 && !needsCountBump) return device;
        const mergedOffsets = { ...offsets };
        missingKeys.forEach((key) => {
          mergedOffsets[key] = defaults[key];
        });
        return {
          ...device,
          registerConfig: {
            ...device.registerConfig,
            count: needsCountBump ? DEFAULT_REGISTER_CONFIG.count : device.registerConfig.count,
            offsets: mergedOffsets as unknown as RegisterOffsetMap,
          },
        };
      }),
    })),
  }));
}

// One-time migration for state saved before per-device mail thresholds
// existed - backfills a default set so older persisted devices don't crash
// the Mail Configuration screen with an undefined mailThresholds.
function migrateMailThresholds(transformers: Transformer[]): Transformer[] {
  return transformers.map((tr) => ({
    ...tr,
    gateways: tr.gateways.map((gw) => ({
      ...gw,
      subDevices: gw.subDevices.map((device) =>
        device.mailThresholds ? device : { ...device, mailThresholds: cloneDefaultMailThresholds() }
      ),
    })),
  }));
}

function loadPersistedState(): PersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<{
      transformers: LegacyTransformerShape[];
      selectedTrId: string;
      nextClientId: number;
    }>;
    if (!Array.isArray(parsed.transformers) || parsed.transformers.length === 0) return null;
    const transformers = migrateMailThresholds(
      migrateIrtccOffsets(migrateSubDevices(resetLiveConnectionFields(migrateToGateways(parsed.transformers))))
    );
    return {
      transformers,
      selectedTrId: typeof parsed.selectedTrId === 'string' ? parsed.selectedTrId : transformers[0].id,
      nextClientId: typeof parsed.nextClientId === 'number' ? parsed.nextClientId : transformers.length + 1,
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
      name: 'TR1 7.5 MVA',
      gateways: [
        {
          id: nanoid(),
          name: 'Gateway 1',
          clientId: 1,
          ipAddress: '192.168.65.100',
          port: 502,
          status: 'disconnected',
          isConnected: false,
          isConnecting: false,
          errorMessage: null,
          subDevices: [
            { id: nanoid(), name: 'TR1 7.5 MVA IRTCC', enabled: true, slaveId: 1, deviceType: 'irtcc', registerConfig: cloneDefaultRegisterConfig(), mailThresholds: cloneDefaultMailThresholds() },
            { id: nanoid(), name: 'TR1 7.5 MVA 2243', enabled: true, slaveId: 11, deviceType: '2243', registerConfig: cloneDefault2243RegisterConfig(), mailThresholds: cloneDefaultMailThresholds() },
            { id: nanoid(), name: 'TR 1 Smart Breather', enabled: false, slaveId: 5, deviceType: 'irtcc', registerConfig: cloneDefaultRegisterConfig(), mailThresholds: cloneDefaultMailThresholds() },
          ],
        },
      ],
    },
    {
      id: nanoid(),
      name: 'TR2 7.5 MVA',
      gateways: [
        {
          id: nanoid(),
          name: 'Gateway 1',
          clientId: 2,
          ipAddress: '192.168.65.252',
          port: 502,
          status: 'disconnected',
          isConnected: false,
          isConnecting: false,
          errorMessage: null,
          subDevices: [
            { id: nanoid(), name: 'TR2 7.5 MVA IRTCC', enabled: true, slaveId: 2, deviceType: 'irtcc', registerConfig: cloneDefaultRegisterConfig(), mailThresholds: cloneDefaultMailThresholds() },
            { id: nanoid(), name: 'TR2 7.5 MVA 2243', enabled: true, slaveId: 22, deviceType: '2243', registerConfig: cloneDefault2243RegisterConfig(), mailThresholds: cloneDefaultMailThresholds() },
          ],
        },
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

function findGateway(state: ConnectionSettingsState, trId: string, gatewayId: string): Gateway | undefined {
  return state.transformers.find((t) => t.id === trId)?.gateways.find((g) => g.id === gatewayId);
}

function findGatewayByClientId(state: ConnectionSettingsState, clientId: number): Gateway | undefined {
  for (const tr of state.transformers) {
    const gw = tr.gateways.find((g) => g.clientId === clientId);
    if (gw) return gw;
  }
  return undefined;
}

// -- Connect one gateway's own connection -- (mirrors ModbusClient.vb Connect(ipAddress, port))
export const connectGatewayAsync = createAsyncThunk<
  { trId: string; gatewayId: string; clientId: number; status: string; isConnected: boolean; errorMessage: string | null },
  { trId: string; gatewayId: string; clientId: number; ipAddress: string; port: number },
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
      trId: request.trId,
      gatewayId: request.gatewayId,
      clientId: result.clientId,
      status: result.status,
      isConnected: result.isConnected,
      errorMessage: result.errorMessage,
    };
  } catch (error: unknown) {
    return rejectWithValue({ trId: request.trId, gatewayId: request.gatewayId, message: extractErrorMessage(error) });
  }
});

// -- Disconnect one gateway's own connection -- (mirrors ModbusClient.vb Disconnect())
export const disconnectGatewayAsync = createAsyncThunk<
  { trId: string; gatewayId: string; status: string; isConnected: boolean },
  { trId: string; gatewayId: string; clientId: number },
  { extra: Dependencies }
>('connectionSettings/disconnectGateway', async (request, { extra }) => {
  const modbus = extra.modbus();
  const result = await modbus.disconnectModbusUseCase.execute({ clientId: request.clientId });
  return { trId: request.trId, gatewayId: request.gatewayId, status: result.status, isConnected: result.isConnected };
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
        name: `TR${state.transformers.length + 1}`,
        gateways: [
          {
            id: nanoid(),
            name: 'Gateway 1',
            clientId,
            ipAddress: '',
            port: 502,
            status: 'disconnected',
            isConnected: false,
            isConnecting: false,
            errorMessage: null,
            subDevices: [],
          },
        ],
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
    addGateway: (state, action: PayloadAction<{ trId: string }>) => {
      const tr = state.transformers.find((t) => t.id === action.payload.trId);
      if (tr) {
        const clientId = state.nextClientId;
        state.nextClientId += 1;
        tr.gateways.push({
          id: nanoid(),
          name: `Gateway ${tr.gateways.length + 1}`,
          clientId,
          ipAddress: '',
          port: 502,
          status: 'disconnected',
          isConnected: false,
          isConnecting: false,
          errorMessage: null,
          subDevices: [],
        });
      }
    },
    removeGateway: (state, action: PayloadAction<{ trId: string; gatewayId: string }>) => {
      const tr = state.transformers.find((t) => t.id === action.payload.trId);
      if (tr) {
        tr.gateways = tr.gateways.filter((gw) => gw.id !== action.payload.gatewayId);
      }
    },
    renameGateway: (state, action: PayloadAction<{ trId: string; gatewayId: string; name: string }>) => {
      const gw = findGateway(state, action.payload.trId, action.payload.gatewayId);
      if (gw) gw.name = action.payload.name;
    },
    updateGatewayConnection: (
      state,
      action: PayloadAction<{ trId: string; gatewayId: string; ipAddress: string; port: number }>
    ) => {
      const gw = findGateway(state, action.payload.trId, action.payload.gatewayId);
      if (gw) {
        gw.ipAddress = action.payload.ipAddress;
        gw.port = action.payload.port;
      }
    },
    clearGatewayError: (state, action: PayloadAction<{ trId: string; gatewayId: string }>) => {
      const gw = findGateway(state, action.payload.trId, action.payload.gatewayId);
      if (gw) gw.errorMessage = null;
    },
    addSubDevice: (
      state,
      action: PayloadAction<{ trId: string; gatewayId: string; deviceType?: DeviceType }>
    ) => {
      const gw = findGateway(state, action.payload.trId, action.payload.gatewayId);
      if (gw) {
        const deviceType = action.payload.deviceType ?? 'irtcc';
        const newDevice: SubDevice = {
          id: nanoid(),
          name: deviceType === '2243' ? 'New 2243 Device' : 'New Device',
          enabled: true,
          slaveId: 1,
          deviceType,
          registerConfig: makeRegisterConfigForType(deviceType),
          mailThresholds: cloneDefaultMailThresholds(),
        };
        gw.subDevices.push(newDevice);
      }
    },
    removeSubDevice: (state, action: PayloadAction<{ trId: string; gatewayId: string; deviceId: string }>) => {
      const gw = findGateway(state, action.payload.trId, action.payload.gatewayId);
      if (gw) {
        gw.subDevices = gw.subDevices.filter((d) => d.id !== action.payload.deviceId);
      }
    },
    updateSubDeviceField: (
      state,
      action: PayloadAction<{ trId: string; gatewayId: string; deviceId: string; field: 'name'; value: string }>
    ) => {
      const gw = findGateway(state, action.payload.trId, action.payload.gatewayId);
      const device = gw?.subDevices.find((d) => d.id === action.payload.deviceId);
      if (device) device[action.payload.field] = action.payload.value;
    },
    updateSubDeviceSlaveId: (
      state,
      action: PayloadAction<{ trId: string; gatewayId: string; deviceId: string; slaveId: number }>
    ) => {
      const gw = findGateway(state, action.payload.trId, action.payload.gatewayId);
      const device = gw?.subDevices.find((d) => d.id === action.payload.deviceId);
      if (device) device.slaveId = action.payload.slaveId;
    },
    toggleSubDeviceEnabled: (state, action: PayloadAction<{ trId: string; gatewayId: string; deviceId: string }>) => {
      const gw = findGateway(state, action.payload.trId, action.payload.gatewayId);
      const device = gw?.subDevices.find((d) => d.id === action.payload.deviceId);
      if (device) device.enabled = !device.enabled;
    },
    updateSubDeviceReadConfig: (
      state,
      action: PayloadAction<{ trId: string; gatewayId: string; deviceId: string; startAddress: number; count: number }>
    ) => {
      const gw = findGateway(state, action.payload.trId, action.payload.gatewayId);
      const device = gw?.subDevices.find((d) => d.id === action.payload.deviceId);
      if (device) {
        device.registerConfig.startAddress = action.payload.startAddress;
        device.registerConfig.count = action.payload.count;
      }
    },
    updateSubDeviceRegisterOffset: (
      state,
      action: PayloadAction<{
        trId: string;
        gatewayId: string;
        deviceId: string;
        field: keyof RegisterOffsetMap | keyof Device2243OffsetMap;
        offset: number;
      }>
    ) => {
      const gw = findGateway(state, action.payload.trId, action.payload.gatewayId);
      const device = gw?.subDevices.find((d) => d.id === action.payload.deviceId);
      if (device) {
        const offsets = device.registerConfig.offsets as unknown as Record<string, number>;
        offsets[action.payload.field] = action.payload.offset;
      }
    },
    updateSubDeviceMailThresholds: (
      state,
      action: PayloadAction<{ trId: string; gatewayId: string; deviceId: string; thresholds: MailThresholds }>
    ) => {
      const gw = findGateway(state, action.payload.trId, action.payload.gatewayId);
      const device = gw?.subDevices.find((d) => d.id === action.payload.deviceId);
      if (device) device.mailThresholds = action.payload.thresholds;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(connectGatewayAsync.pending, (state, action) => {
        const gw = findGateway(state, action.meta.arg.trId, action.meta.arg.gatewayId);
        if (gw) {
          gw.isConnecting = true;
          gw.status = 'connecting';
          gw.errorMessage = null;
        }
      })
      .addCase(connectGatewayAsync.fulfilled, (state, action) => {
        const gw = findGateway(state, action.payload.trId, action.payload.gatewayId);
        if (gw) {
          gw.isConnecting = false;
          gw.status = action.payload.status as Gateway['status'];
          gw.isConnected = action.payload.isConnected;
          gw.errorMessage = action.payload.errorMessage;
        }
      })
      .addCase(connectGatewayAsync.rejected, (state, action) => {
        const payload = action.payload as { trId: string; gatewayId: string; message: string } | undefined;
        const trId = payload?.trId ?? action.meta.arg.trId;
        const gatewayId = payload?.gatewayId ?? action.meta.arg.gatewayId;
        const gw = findGateway(state, trId, gatewayId);
        if (gw) {
          gw.isConnecting = false;
          gw.status = 'error';
          gw.isConnected = false;
          gw.errorMessage = payload?.message ?? 'Connection failed';
        }
      })
      .addCase(disconnectGatewayAsync.fulfilled, (state, action) => {
        const gw = findGateway(state, action.payload.trId, action.payload.gatewayId);
        if (gw) {
          gw.status = action.payload.status as Gateway['status'];
          gw.isConnected = action.payload.isConnected;
          gw.errorMessage = null;
        }
      })
      // A read/write against a dead socket tells us the gateway's connection
      // for this clientId dropped (ModbusClient disconnects itself on a
      // framing/timeout error, since the byte stream can't be resynced) -
      // mirror that into isConnected here so the auto-reconnect watcher in
      // TmsAppLayout notices and retries, instead of leaving the UI stuck
      // showing "connected" against a socket that's actually gone.
      .addCase(readTransformerRegistersAsync.fulfilled, (state, action) => {
        if (action.payload.isConnected) return;
        const gw = findGatewayByClientId(state, action.meta.arg.clientId);
        if (gw && gw.isConnected) {
          gw.isConnected = false;
          gw.status = 'error';
          gw.errorMessage = action.payload.errorMessage;
        }
      })
      .addCase(readTransformerRegistersAsync.rejected, (state, action) => {
        const payload = action.payload as { isConnected?: boolean; message?: string } | undefined;
        if (payload?.isConnected !== false) return;
        const gw = findGatewayByClientId(state, action.meta.arg.clientId);
        if (gw && gw.isConnected) {
          gw.isConnected = false;
          gw.status = 'error';
          gw.errorMessage = payload.message ?? 'Read failed';
        }
      })
      .addCase(writeRegisterAsync.fulfilled, (state, action) => {
        if (action.payload.isConnected) return;
        const gw = findGatewayByClientId(state, action.meta.arg.clientId);
        if (gw && gw.isConnected) {
          gw.isConnected = false;
          gw.status = 'error';
          gw.errorMessage = action.payload.errorMessage;
        }
      })
      .addCase(writeRegisterAsync.rejected, (state, action) => {
        const payload = action.payload as { isConnected?: boolean; message?: string } | undefined;
        if (payload?.isConnected !== false) return;
        const gw = findGatewayByClientId(state, action.meta.arg.clientId);
        if (gw && gw.isConnected) {
          gw.isConnected = false;
          gw.status = 'error';
          gw.errorMessage = payload.message ?? 'Write failed';
        }
      });
  },
});

export const {
  selectTr,
  addTransformer,
  removeTransformer,
  renameTransformer,
  addGateway,
  removeGateway,
  renameGateway,
  updateGatewayConnection,
  clearGatewayError,
  addSubDevice,
  removeSubDevice,
  updateSubDeviceField,
  updateSubDeviceSlaveId,
  toggleSubDeviceEnabled,
  updateSubDeviceReadConfig,
  updateSubDeviceRegisterOffset,
  updateSubDeviceMailThresholds,
} = connectionSettingsSlice.actions;
export default connectionSettingsSlice.reducer;

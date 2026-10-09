import { createSlice, nanoid } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { DeviceType, Transformer, Gateway, SubDevice } from '../../domain/entities/ConnectionSettings';
import type { RegisterOffsetMap } from '../../domain/entities/TransformerRegisterMap';
import { DEFAULT_REGISTER_CONFIG } from '../../domain/entities/TransformerRegisterMap';
import type { Device2243OffsetMap } from '../../domain/entities/Device2243RegisterMap';
import { DEFAULT_2243_REGISTER_CONFIG } from '../../domain/entities/Device2243RegisterMap';
import type { MailThresholds } from '../../domain/entities/MailSettings';
import { DEFAULT_MAIL_THRESHOLDS } from '../../domain/entities/MailSettings';
import type { GatewayServiceConfig } from '../../domain/entities/Modbus';
import { gatewayServiceUnreachable, liveSnapshotReceived } from '../live/actions';

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
  // How often (in seconds) every device's latest reading is pushed to
  // tms-backend for historical storage/audit/mail-threshold evaluation -
  // see TmsAppLayout's own readings-push effect, which reads this value
  // instead of a hardcoded constant. App-wide (not per-transformer), since
  // it's one shared interval/timer regardless of how many transformers are
  // configured. Floor enforced at MIN_READINGS_PUSH_INTERVAL_SECONDS
  // wherever this is set, not just in the UI, so a corrupted/hand-edited
  // localStorage value below the floor can't silently take effect.
  readingsPushIntervalSeconds: number;
  // Version (ms timestamp) of these settings as last synced with the
  // gateway service, which keeps its own copy and does the polling - see
  // features/live/useGatewayService. 0 = never synced.
  configVersion: number;
}

export const MIN_READINGS_PUSH_INTERVAL_SECONDS = 60;
const DEFAULT_READINGS_PUSH_INTERVAL_SECONDS = 60;

const PERSIST_KEY = 'tms-connection-settings';

type PersistedState = Pick<
  ConnectionSettingsState,
  'transformers' | 'selectedTrId' | 'nextClientId' | 'readingsPushIntervalSeconds' | 'configVersion'
>;

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
        // The AVR status register used to default to 9 - the same position
        // as OTI Temperature - so AVR status bits were decoded from the
        // temperature. Move it to the correct default (8) wherever it still
        // collides with OTI Temperature; a deliberately chosen value never
        // collides, so this never overrides one.
        const avrStatusCollides = offsets.avrStatusWord === offsets.otiTemperature;
        if (missingKeys.length === 0 && !needsCountBump && !avrStatusCollides) return device;
        const mergedOffsets = { ...offsets };
        missingKeys.forEach((key) => {
          mergedOffsets[key] = defaults[key];
        });
        if (avrStatusCollides) mergedOffsets.avrStatusWord = defaults.avrStatusWord;
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

// clientId is the gateway server's key for one TCP connection - two gateways
// sharing a clientId share one socket, so connecting either one tears down
// the other's connection and the two keep knocking each other offline.
// Older saved state could end up with duplicates (the legacy migration
// defaulted every TR to clientId 1) - give any repeat a fresh id.
function ensureUniqueClientIds(transformers: Transformer[]): Transformer[] {
  const seen = new Set<number>();
  let next = Math.max(0, ...transformers.flatMap((tr) => tr.gateways.map((gw) => gw.clientId))) + 1;
  return transformers.map((tr) => ({
    ...tr,
    gateways: tr.gateways.map((gw) => {
      if (!seen.has(gw.clientId)) {
        seen.add(gw.clientId);
        return gw;
      }
      const clientId = next++;
      seen.add(clientId);
      return { ...gw, clientId };
    }),
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
      readingsPushIntervalSeconds: number;
      configVersion: number;
    }>;
    if (!Array.isArray(parsed.transformers) || parsed.transformers.length === 0) return null;
    const transformers = ensureUniqueClientIds(
      migrateMailThresholds(
        migrateIrtccOffsets(migrateSubDevices(resetLiveConnectionFields(migrateToGateways(parsed.transformers))))
      )
    );
    const maxClientId = Math.max(0, ...transformers.flatMap((tr) => tr.gateways.map((gw) => gw.clientId)));
    return {
      transformers,
      selectedTrId: typeof parsed.selectedTrId === 'string' ? parsed.selectedTrId : transformers[0].id,
      nextClientId: Math.max(typeof parsed.nextClientId === 'number' ? parsed.nextClientId : 0, maxClientId + 1),
      readingsPushIntervalSeconds:
        typeof parsed.readingsPushIntervalSeconds === 'number' &&
        parsed.readingsPushIntervalSeconds >= MIN_READINGS_PUSH_INTERVAL_SECONDS
          ? parsed.readingsPushIntervalSeconds
          : DEFAULT_READINGS_PUSH_INTERVAL_SECONDS,
      configVersion: typeof parsed.configVersion === 'number' ? parsed.configVersion : 0,
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
    readingsPushIntervalSeconds: state.readingsPushIntervalSeconds,
    configVersion: state.configVersion,
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
  readingsPushIntervalSeconds: DEFAULT_READINGS_PUSH_INTERVAL_SECONDS,
  configVersion: 0,
};

function findGateway(state: ConnectionSettingsState, trId: string, gatewayId: string): Gateway | undefined {
  return state.transformers.find((t) => t.id === trId)?.gateways.find((g) => g.id === gatewayId);
}

// Settings coming back from the gateway service (another tab/browser
// changed them, or this browser's saved copy was older). Connection states
// already shown are kept until the next live snapshot replaces them.
function transformersFromGateway(config: GatewayServiceConfig, previous: Transformer[]): Transformer[] {
  const previousGateways = new Map(previous.flatMap((tr) => tr.gateways).map((gw) => [gw.id, gw]));
  // Mail thresholds aren't part of the gateway's copy - keep this browser's.
  const previousDevices = new Map(previous.flatMap((tr) => tr.gateways.flatMap((gw) => gw.subDevices)).map((d) => [d.id, d]));
  const transformers: Transformer[] = config.transformers.map((tr) => ({
    id: tr.id,
    name: tr.name,
    gateways: tr.gateways.map((gw) => {
      const old = previousGateways.get(gw.id);
      return {
        id: gw.id,
        name: gw.name,
        clientId: gw.clientId,
        ipAddress: gw.ipAddress,
        port: gw.port,
        busGroup: gw.busGroup,
        autoReconnect: gw.autoConnect,
        status: old?.status ?? 'disconnected',
        isConnected: old?.isConnected ?? false,
        isConnecting: old?.isConnecting ?? false,
        errorMessage: old?.errorMessage ?? null,
        subDevices: (gw.subDevices as unknown as SubDevice[]).map((device) => ({
          ...device,
          mailThresholds: previousDevices.get(device.id)?.mailThresholds ?? device.mailThresholds,
        })),
      };
    }),
  }));
  return ensureUniqueClientIds(migrateMailThresholds(migrateIrtccOffsets(migrateSubDevices(transformers))));
}

const connectionSettingsSlice = createSlice({
  name: 'connectionSettings',
  initialState,
  reducers: {
    setConfigVersion: (state, action: PayloadAction<number>) => {
      state.configVersion = action.payload;
    },
    replaceConfigFromGateway: (state, action: PayloadAction<GatewayServiceConfig>) => {
      const config = action.payload;
      state.transformers = transformersFromGateway(config, state.transformers);
      state.readingsPushIntervalSeconds = Math.max(MIN_READINGS_PUSH_INTERVAL_SECONDS, config.readingsPushIntervalSeconds);
      state.configVersion = config.version;
      const maxClientId = Math.max(0, ...state.transformers.flatMap((tr) => tr.gateways.map((gw) => gw.clientId)));
      state.nextClientId = Math.max(state.nextClientId, maxClientId + 1);
      if (!state.transformers.some((tr) => tr.id === state.selectedTrId)) {
        state.selectedTrId = state.transformers[0]?.id ?? '';
      }
    },
    // Connect / Disconnect buttons: the gateway service connects and polls
    // only gateways with this on (synced to it as `autoConnect`).
    setGatewayAutoConnect: (state, action: PayloadAction<{ trId: string; gatewayId: string; autoConnect: boolean }>) => {
      const gw = findGateway(state, action.payload.trId, action.payload.gatewayId);
      if (gw) {
        gw.autoReconnect = action.payload.autoConnect;
        gw.errorMessage = null;
        if (action.payload.autoConnect) {
          gw.status = 'connecting';
          gw.isConnecting = true;
        } else {
          gw.status = 'disconnected';
          gw.isConnected = false;
          gw.isConnecting = false;
        }
      }
    },
    selectTr: (state, action: PayloadAction<string>) => {
      state.selectedTrId = action.payload;
    },
    // Enforces the 1-minute floor here, not just in the Settings UI, so a
    // bad value can never take effect regardless of how it was set.
    setReadingsPushIntervalSeconds: (state, action: PayloadAction<number>) => {
      state.readingsPushIntervalSeconds = Math.max(MIN_READINGS_PUSH_INTERVAL_SECONDS, Math.round(action.payload));
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
        gw.autoReconnect = false;
      }
    },
    updateGatewayBusGroup: (state, action: PayloadAction<{ trId: string; gatewayId: string; busGroup: string }>) => {
      const gw = findGateway(state, action.payload.trId, action.payload.gatewayId);
      if (gw) {
        gw.busGroup = action.payload.busGroup;
        gw.autoReconnect = false;
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
      // Connection states come from the gateway service, which owns the
      // connections - see features/live.
      .addCase(liveSnapshotReceived, (state, action) => {
        const { gateways } = action.payload.snapshot;
        for (const tr of state.transformers) {
          for (const gw of tr.gateways) {
            const live = gateways[gw.id];
            if (live) {
              gw.status = live.status;
              gw.isConnected = live.isConnected;
              gw.isConnecting = live.isConnecting;
              gw.errorMessage = live.errorMessage;
            } else if (gw.autoReconnect === false || gw.ipAddress.trim() === '') {
              gw.status = 'disconnected';
              gw.isConnected = false;
              gw.isConnecting = false;
            }
          }
        }
      })
      .addCase(gatewayServiceUnreachable, (state, action) => {
        for (const tr of state.transformers) {
          for (const gw of tr.gateways) {
            if (gw.autoReconnect === false || gw.ipAddress.trim() === '') continue;
            gw.status = 'error';
            gw.isConnected = false;
            gw.isConnecting = false;
            gw.errorMessage = action.payload;
          }
        }
      });
  },
});

export const {
  setConfigVersion,
  replaceConfigFromGateway,
  setGatewayAutoConnect,
  selectTr,
  addTransformer,
  removeTransformer,
  renameTransformer,
  addGateway,
  removeGateway,
  renameGateway,
  updateGatewayConnection,
  updateGatewayBusGroup,
  clearGatewayError,
  addSubDevice,
  removeSubDevice,
  updateSubDeviceField,
  updateSubDeviceSlaveId,
  toggleSubDeviceEnabled,
  updateSubDeviceReadConfig,
  updateSubDeviceRegisterOffset,
  updateSubDeviceMailThresholds,
  setReadingsPushIntervalSeconds,
} = connectionSettingsSlice.actions;
export default connectionSettingsSlice.reducer;

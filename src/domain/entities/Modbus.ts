// -- Connection status --
// Mirrors ModbusClient.vb: StatusChanged(clientId, status, connected) / ErrorOccurred(clientId, errorMsg, slaveId)
export type ModbusConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ModbusReadRequest {
  clientId: number;
  slaveId: number;
  startAddress: number;
  count: number;
}

export interface ModbusReadResult {
  clientId: number;
  slaveId: number;
  startAddress: number;
  registers: number[] | null;
  errorMessage: string | null;
  // The gateway's live socket state right after this read - a framing or
  // timeout error tears the underlying connection down (unrecoverable byte
  // stream desync), so this is how callers tell "transient error, still
  // connected" apart from "connection actually dropped, needs reconnect."
  isConnected: boolean;
}

// -- FC06: Write Single Register --
export interface ModbusWriteRequest {
  clientId: number;
  slaveId: number;
  address: number;
  value: number;
}

export interface ModbusWriteResult {
  clientId: number;
  address: number;
  value: number;
  errorMessage: string | null;
  isConnected: boolean;
}

// -- Gateway service (server/) --
// The gateway service owns the hardware: it stores the device configuration
// below, polls every device once a second and pushes readings to the
// backend, independent of any browser tab. The website uploads the
// configuration and displays the live snapshot.

export interface GatewayServiceDevice {
  id: string;
  name: string;
  enabled: boolean;
  slaveId: number;
  deviceType: 'irtcc' | '2243';
  registerConfig: unknown;
  [extra: string]: unknown;
}

export interface GatewayServiceGateway {
  id: string;
  name: string;
  clientId: number;
  ipAddress: string;
  port: number;
  autoConnect: boolean;
  busGroup?: string;
  subDevices: GatewayServiceDevice[];
}

export interface GatewayServiceConfig {
  // Timestamp (ms) of the edit it came from - an older upload is refused.
  version: number;
  readingsPushIntervalSeconds: number;
  transformers: { id: string; name: string; gateways: GatewayServiceGateway[] }[];
}

export type PutConfigResult =
  | { status: 'saved'; config: GatewayServiceConfig }
  // The gateway already has newer settings (another tab/browser) - those
  // are returned so this tab can switch to them.
  | { status: 'conflict'; config: GatewayServiceConfig };

export interface LiveDeviceReading {
  registers: number[] | null;
  errorMessage: string | null;
  lastReadAt: string | null;
  lastSuccessAt: string | null;
}

export interface LiveGatewayState {
  status: ModbusConnectionStatus;
  isConnected: boolean;
  isConnecting: boolean;
  errorMessage: string | null;
}

export interface LivePushStatus {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  failuresInARow: number;
}

export interface LiveSnapshot {
  configVersion: number;
  gateways: Record<string, LiveGatewayState>;
  devices: Record<string, LiveDeviceReading>;
  push: LivePushStatus;
  serverTime: string;
}

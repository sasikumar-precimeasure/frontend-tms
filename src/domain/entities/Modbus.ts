// -- Connection status --
// Mirrors ModbusClient.vb: StatusChanged(clientId, status, connected) / ErrorOccurred(clientId, errorMsg, slaveId)
export type ModbusConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ModbusConnection {
  clientId: number;
  ipAddress: string;
  port: number;
  status: ModbusConnectionStatus;
  isConnected: boolean;
  errorMessage: string | null;
}

export interface ModbusConnectRequest {
  clientId: number;
  ipAddress: string;
  port: number;
}

export interface ModbusDisconnectRequest {
  clientId: number;
}

// -- FC03: Read Holding Registers --
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

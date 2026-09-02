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
}

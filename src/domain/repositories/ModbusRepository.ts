import type {
  ModbusConnection,
  ModbusConnectRequest,
  ModbusDisconnectRequest,
  ModbusReadRequest,
  ModbusReadResult,
} from '../entities/Modbus';

// Mirrors ModbusClient.vb's Connect(ipAddress, port) / Disconnect() / IsConnected / ReadRegisters (FC03)
export interface ModbusRepository {
  connect(request: ModbusConnectRequest): Promise<ModbusConnection>;
  disconnect(request: ModbusDisconnectRequest): Promise<ModbusConnection>;
  getStatus(clientId: number): Promise<ModbusConnection>;
  readHoldingRegisters(request: ModbusReadRequest): Promise<ModbusReadResult>;
}

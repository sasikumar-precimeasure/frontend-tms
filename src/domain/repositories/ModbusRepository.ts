import type { ModbusConnection, ModbusConnectRequest, ModbusDisconnectRequest } from '../entities/Modbus';

// Mirrors ModbusClient.vb's Connect(ipAddress, port) / Disconnect() / IsConnected
export interface ModbusRepository {
  connect(request: ModbusConnectRequest): Promise<ModbusConnection>;
  disconnect(request: ModbusDisconnectRequest): Promise<ModbusConnection>;
  getStatus(clientId: number): Promise<ModbusConnection>;
}

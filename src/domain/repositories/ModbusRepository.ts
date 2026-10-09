import type {
  GatewayServiceConfig,
  LiveSnapshot,
  ModbusReadRequest,
  ModbusReadResult,
  ModbusWriteRequest,
  ModbusWriteResult,
  PutConfigResult,
} from '../entities/Modbus';

export interface ModbusRepository {
  getConfig(): Promise<GatewayServiceConfig>;
  putConfig(config: GatewayServiceConfig): Promise<PutConfigResult>;
  getLive(): Promise<LiveSnapshot>;
  readHoldingRegisters(request: ModbusReadRequest): Promise<ModbusReadResult>;
  writeSingleRegister(request: ModbusWriteRequest): Promise<ModbusWriteResult>;
}

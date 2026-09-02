import type { ModbusConnection, ModbusConnectRequest } from '../entities/Modbus';
import type { ModbusRepository } from '../repositories/ModbusRepository';

export class ConnectModbusUseCase {
  private modbusRepository: ModbusRepository;

  constructor(modbusRepository: ModbusRepository) {
    this.modbusRepository = modbusRepository;
  }

  async execute(request: ModbusConnectRequest): Promise<ModbusConnection> {
    return this.modbusRepository.connect(request);
  }
}

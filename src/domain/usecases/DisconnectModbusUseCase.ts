import type { ModbusConnection, ModbusDisconnectRequest } from '../entities/Modbus';
import type { ModbusRepository } from '../repositories/ModbusRepository';

export class DisconnectModbusUseCase {
  private modbusRepository: ModbusRepository;

  constructor(modbusRepository: ModbusRepository) {
    this.modbusRepository = modbusRepository;
  }

  async execute(request: ModbusDisconnectRequest): Promise<ModbusConnection> {
    return this.modbusRepository.disconnect(request);
  }
}

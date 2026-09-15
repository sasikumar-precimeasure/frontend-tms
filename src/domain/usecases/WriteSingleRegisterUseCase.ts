import type { ModbusWriteRequest, ModbusWriteResult } from '../entities/Modbus';
import type { ModbusRepository } from '../repositories/ModbusRepository';

// Mirrors ModbusClient.vb's WriteSingleRegister (FC06 - Write Single Register)
export class WriteSingleRegisterUseCase {
  private modbusRepository: ModbusRepository;

  constructor(modbusRepository: ModbusRepository) {
    this.modbusRepository = modbusRepository;
  }

  async execute(request: ModbusWriteRequest): Promise<ModbusWriteResult> {
    return this.modbusRepository.writeSingleRegister(request);
  }
}

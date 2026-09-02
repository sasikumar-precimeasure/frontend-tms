import type { ModbusReadRequest, ModbusReadResult } from '../entities/Modbus';
import type { ModbusRepository } from '../repositories/ModbusRepository';

// Mirrors ModbusClient.vb's ReadRegisters (FC03 - Read Holding Registers)
export class ReadHoldingRegistersUseCase {
  private modbusRepository: ModbusRepository;

  constructor(modbusRepository: ModbusRepository) {
    this.modbusRepository = modbusRepository;
  }

  async execute(request: ModbusReadRequest): Promise<ModbusReadResult> {
    return this.modbusRepository.readHoldingRegisters(request);
  }
}

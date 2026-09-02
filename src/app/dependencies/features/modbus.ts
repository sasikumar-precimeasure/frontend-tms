import axios from 'axios';
import { ModbusRepositoryImpl } from '../../../infrastructure/repositories/ModbusRepositoryImpl';
import { ConnectModbusUseCase } from '../../../domain/usecases/ConnectModbusUseCase';
import { DisconnectModbusUseCase } from '../../../domain/usecases/DisconnectModbusUseCase';
import type { ModbusDependencies } from '../types';

// Local gateway service (server/) that owns the real TCP socket to the hardware -
// separate from the main authenticated apiClient, since it's a different host/service.
const GATEWAY_BASE_URL = import.meta.env.VITE_MODBUS_GATEWAY_URL || 'http://localhost:4000';

export function createModbusDependencies(): ModbusDependencies {
  const gatewayClient = axios.create({ baseURL: GATEWAY_BASE_URL });
  const modbusRepository = new ModbusRepositoryImpl(gatewayClient);

  const connectModbusUseCase = new ConnectModbusUseCase(modbusRepository);
  const disconnectModbusUseCase = new DisconnectModbusUseCase(modbusRepository);

  return {
    modbusRepository,
    connectModbusUseCase,
    disconnectModbusUseCase,
  };
}

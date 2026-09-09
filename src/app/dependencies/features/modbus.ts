import axios from 'axios';
import { ModbusRepositoryImpl } from '../../../infrastructure/repositories/ModbusRepositoryImpl';
import { ConnectModbusUseCase } from '../../../domain/usecases/ConnectModbusUseCase';
import { DisconnectModbusUseCase } from '../../../domain/usecases/DisconnectModbusUseCase';
import { ReadHoldingRegistersUseCase } from '../../../domain/usecases/ReadHoldingRegistersUseCase';
import type { ModbusDependencies } from '../types';

// Local gateway service (server/) that owns the real TCP socket to the hardware -
// separate from the main authenticated apiClient, since it's a different host/service.
const GATEWAY_BASE_URL = import.meta.env.VITE_MODBUS_GATEWAY_URL || 'http://localhost:4000';

export function createModbusDependencies(): ModbusDependencies {
  const gatewayClient = axios.create({ baseURL: GATEWAY_BASE_URL });

  // Log every request/response to the Modbus gateway in the browser console -
  // separate from the gateway's own terminal logs, which are only visible in
  // the Node process running server/ (never in the browser).
  gatewayClient.interceptors.request.use((config) => {
    const url = `${config.baseURL ?? ''}${config.url ?? ''}`;
    console.log(
      `[Modbus] --> ${config.method?.toUpperCase()} ${url}`,
      config.params ?? config.data ?? {}
    );
    return config;
  });

  gatewayClient.interceptors.response.use(
    (response) => {
      const url = `${response.config.baseURL ?? ''}${response.config.url ?? ''}`;
      console.log(
        `[Modbus] <-- ${response.config.method?.toUpperCase()} ${url} ${response.status}`,
        response.data
      );
      return response;
    },
    (error) => {
      const config = error.config ?? {};
      const url = `${config.baseURL ?? ''}${config.url ?? ''}`;
      console.log(
        `[Modbus] <-- ${config.method?.toUpperCase?.() ?? '?'} ${url} ${error.response?.status ?? 'ERROR'}`,
        error.response?.data ?? error.message
      );
      return Promise.reject(error);
    }
  );

  const modbusRepository = new ModbusRepositoryImpl(gatewayClient);

  const connectModbusUseCase = new ConnectModbusUseCase(modbusRepository);
  const disconnectModbusUseCase = new DisconnectModbusUseCase(modbusRepository);
  const readHoldingRegistersUseCase = new ReadHoldingRegistersUseCase(modbusRepository);

  return {
    modbusRepository,
    connectModbusUseCase,
    disconnectModbusUseCase,
    readHoldingRegistersUseCase,
  };
}

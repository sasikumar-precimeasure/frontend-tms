import axios from 'axios';
import { ModbusRepositoryImpl } from '../../../infrastructure/repositories/ModbusRepositoryImpl';
import { ConnectModbusUseCase } from '../../../domain/usecases/ConnectModbusUseCase';
import { DisconnectModbusUseCase } from '../../../domain/usecases/DisconnectModbusUseCase';
import { ReadHoldingRegistersUseCase } from '../../../domain/usecases/ReadHoldingRegistersUseCase';
import { WriteSingleRegisterUseCase } from '../../../domain/usecases/WriteSingleRegisterUseCase';
import type { ModbusDependencies } from '../types';

// Local gateway service (server/) that owns the real TCP socket to the hardware -
// separate from the main authenticated apiClient, since it's a different host/service.
const GATEWAY_BASE_URL = import.meta.env.VITE_MODBUS_GATEWAY_URL || 'http://localhost:4000';

// Generous margin above the gateway server's own longest internal timeout
// (ModbusClient.ts's CONNECT_TIMEOUT_MS = 3000ms for a connect attempt) -
// without this, an axios request has no timeout at all by default, so if
// the gateway process ever fails to respond for any reason (a hung
// process, a dropped connection to it, an unexpected exception bypassing
// its own timeout handling), the UI would show "connecting"/"reading"
// forever with no way to recover short of a full page reload. This bounds
// every request to the gateway to a hard ceiling so the UI can always move
// on to a visible error state instead.
const GATEWAY_REQUEST_TIMEOUT_MS = 8000;

// Identifies this browser tab to the gateway server, which namespaces every
// clientId by it - clientIds are only unique within one tab's settings, so
// without this a second tab (or a stale one holding older settings) using
// the same clientId for a different IP/port kept stealing this tab's
// connection. sessionStorage keeps the id stable across reloads of the same
// tab, so a reload reuses its connections instead of orphaning them.
function getGatewayInstanceId(): string {
  const KEY = 'tms-gateway-instance-id';
  try {
    const existing = window.sessionStorage.getItem(KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.sessionStorage.setItem(KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

export function createModbusDependencies(): ModbusDependencies {
  const gatewayClient = axios.create({
    baseURL: GATEWAY_BASE_URL,
    timeout: GATEWAY_REQUEST_TIMEOUT_MS,
    headers: { 'X-Tms-Instance': getGatewayInstanceId() },
  });

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
  const writeSingleRegisterUseCase = new WriteSingleRegisterUseCase(modbusRepository);

  return {
    modbusRepository,
    connectModbusUseCase,
    disconnectModbusUseCase,
    readHoldingRegistersUseCase,
    writeSingleRegisterUseCase,
  };
}

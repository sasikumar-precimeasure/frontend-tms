import axios from 'axios';
import { ModbusRepositoryImpl } from '../../../infrastructure/repositories/ModbusRepositoryImpl';
import { ReadHoldingRegistersUseCase } from '../../../domain/usecases/ReadHoldingRegistersUseCase';
import { WriteSingleRegisterUseCase } from '../../../domain/usecases/WriteSingleRegisterUseCase';
import type { InfrastructureDependencies, ModbusDependencies } from '../types';

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

export function createModbusDependencies(infrastructure: InfrastructureDependencies): ModbusDependencies {
  const gatewayClient = axios.create({ baseURL: GATEWAY_BASE_URL, timeout: GATEWAY_REQUEST_TIMEOUT_MS });

  // Log every request/response to the Modbus gateway in the browser console -
  // separate from the gateway's own terminal logs, which are only visible in
  // the Node process running server/ (never in the browser). The once-a-second
  // /api/live poll is left out (it would drown everything else); its
  // failures are still logged.
  const isLivePoll = (url: string | undefined) => url === '/api/live';

  // Settings changes and hardware commands need the logged-in user's token -
  // the gateway service checks their write permission with the backend.
  gatewayClient.interceptors.request.use((config) => {
    const token = infrastructure.storageRepository.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });
  gatewayClient.interceptors.request.use((config) => {
    if (isLivePoll(config.url)) return config;
    const url = `${config.baseURL ?? ''}${config.url ?? ''}`;
    console.log(
      `[Modbus] --> ${config.method?.toUpperCase()} ${url}`,
      config.params ?? config.data ?? {}
    );
    return config;
  });

  gatewayClient.interceptors.response.use(
    (response) => {
      if (isLivePoll(response.config.url)) return response;
      const url = `${response.config.baseURL ?? ''}${response.config.url ?? ''}`;
      console.log(
        `[Modbus] <-- ${response.config.method?.toUpperCase()} ${url} ${response.status}`,
        response.data
      );
      return response;
    },
    async (error) => {
      const config = error.config ?? {};
      // Expired login: any backend call through the main API client renews
      // the token (its own refresh-and-retry), then retry this once.
      if (error.response?.status === 401 && !config._authRetried) {
        config._authRetried = true;
        try {
          await infrastructure.apiClient.get('/tms/api/users/me');
          return await gatewayClient.request(config);
        } catch {
          // fall through to the normal error below
        }
      }
      const url = `${config.baseURL ?? ''}${config.url ?? ''}`;
      console.log(
        `[Modbus] <-- ${config.method?.toUpperCase?.() ?? '?'} ${url} ${error.response?.status ?? 'ERROR'}`,
        error.response?.data ?? error.message
      );
      return Promise.reject(error);
    }
  );

  const modbusRepository = new ModbusRepositoryImpl(gatewayClient);

  const readHoldingRegistersUseCase = new ReadHoldingRegistersUseCase(modbusRepository);
  const writeSingleRegisterUseCase = new WriteSingleRegisterUseCase(modbusRepository);

  return {
    modbusRepository,
    readHoldingRegistersUseCase,
    writeSingleRegisterUseCase,
  };
}

import type { AxiosInstance } from 'axios';
import type { ModbusRepository } from '../../domain/repositories/ModbusRepository';
import type {
  ModbusConnection,
  ModbusConnectRequest,
  ModbusDisconnectRequest,
} from '../../domain/entities/Modbus';

// Calls the local Modbus gateway service (server/), which owns the real TCP
// socket to the hardware via Node's net.Socket - the direct equivalent of
// System.Net.Sockets.TcpClient in ModbusClient.vb. A browser cannot open a
// raw TCP socket itself, so this gateway is what actually plays the VB
// class's role; this repository just calls its Connect/Disconnect endpoints.
export class ModbusRepositoryImpl implements ModbusRepository {
  private apiClient: AxiosInstance;

  constructor(apiClient: AxiosInstance) {
    this.apiClient = apiClient;
  }

  async connect(request: ModbusConnectRequest): Promise<ModbusConnection> {
    try {
      const response = await this.apiClient.post<ModbusConnection>('/api/modbus/connect', request);
      return response.data;
    } catch (ex) {
      const data = this.extractErrorPayload(ex);
      if (data) return data;
      throw ex;
    }
  }

  async disconnect(request: ModbusDisconnectRequest): Promise<ModbusConnection> {
    const response = await this.apiClient.post<ModbusConnection>('/api/modbus/disconnect', request);
    return response.data;
  }

  async getStatus(clientId: number): Promise<ModbusConnection> {
    const response = await this.apiClient.get<ModbusConnection>(`/api/modbus/status/${clientId}`);
    return response.data;
  }

  // The gateway responds 502 with a ModbusConnection body on connect failure
  // (mirrors ModbusClient.vb raising ErrorOccurred instead of throwing).
  private extractErrorPayload(ex: unknown): ModbusConnection | null {
    if (
      ex &&
      typeof ex === 'object' &&
      'response' in ex &&
      ex.response &&
      typeof ex.response === 'object' &&
      'data' in ex.response
    ) {
      return (ex.response as { data: ModbusConnection }).data;
    }
    return null;
  }
}

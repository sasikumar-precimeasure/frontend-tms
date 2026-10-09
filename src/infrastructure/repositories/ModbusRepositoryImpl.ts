import { AxiosError } from 'axios';
import type { AxiosInstance } from 'axios';
import type { ModbusRepository } from '../../domain/repositories/ModbusRepository';
import type {
  GatewayServiceConfig,
  LiveSnapshot,
  PutConfigResult,
  ModbusReadRequest,
  ModbusReadResult,
  ModbusWriteRequest,
  ModbusWriteResult,
} from '../../domain/entities/Modbus';

// Calls the local Modbus gateway service (server/), which owns the real TCP
// sockets to the hardware and polls every device itself. This repository
// syncs the device configuration with it, fetches its live snapshot, and
// sends on-demand reads/writes.
export class ModbusRepositoryImpl implements ModbusRepository {
  private apiClient: AxiosInstance;

  constructor(apiClient: AxiosInstance) {
    this.apiClient = apiClient;
  }

  async getConfig(): Promise<GatewayServiceConfig> {
    const response = await this.apiClient.get<{ config: GatewayServiceConfig }>('/api/config');
    return response.data.config;
  }

  async putConfig(config: GatewayServiceConfig): Promise<PutConfigResult> {
    try {
      const response = await this.apiClient.put<{ config: GatewayServiceConfig }>('/api/config', { config });
      return { status: 'saved', config: response.data.config };
    } catch (ex) {
      const conflict = this.extractErrorPayload<{ config?: GatewayServiceConfig }>(ex);
      if (ex instanceof AxiosError && ex.response?.status === 409 && conflict?.config) {
        return { status: 'conflict', config: conflict.config };
      }
      throw ex;
    }
  }

  async getLive(): Promise<LiveSnapshot> {
    const response = await this.apiClient.get<LiveSnapshot>('/api/live');
    return response.data;
  }

  async readHoldingRegisters(request: ModbusReadRequest): Promise<ModbusReadResult> {
    try {
      const response = await this.apiClient.get<ModbusReadResult>(`/api/modbus/read/${request.clientId}`, {
        params: { slaveId: request.slaveId, startAddress: request.startAddress, count: request.count },
      });
      return response.data;
    } catch (ex) {
      const data = this.extractErrorPayload<ModbusReadResult>(ex);
      if (data) return data;
      throw ex;
    }
  }

  async writeSingleRegister(request: ModbusWriteRequest): Promise<ModbusWriteResult> {
    try {
      const response = await this.apiClient.post<ModbusWriteResult>('/api/modbus/write', request);
      return response.data;
    } catch (ex) {
      const data = this.extractErrorPayload<ModbusWriteResult>(ex);
      if (data) return data;
      throw ex;
    }
  }

  // The gateway responds with a typed error body on failure (mirrors
  // ModbusClient.vb raising ErrorOccurred instead of throwing).
  private extractErrorPayload<T>(ex: unknown): T | null {
    if (
      ex &&
      typeof ex === 'object' &&
      'response' in ex &&
      ex.response &&
      typeof ex.response === 'object' &&
      'data' in ex.response
    ) {
      return (ex.response as { data: T }).data;
    }
    return null;
  }
}

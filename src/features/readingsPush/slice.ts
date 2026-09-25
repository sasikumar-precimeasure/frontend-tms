import { createAsyncThunk } from '@reduxjs/toolkit';
import type { Dependencies } from '../../app/dependencies';
import type { DashboardReadings } from '../../domain/entities/TransformerRegisterMap';
import type { Device2243Readings } from '../../domain/entities/Device2243RegisterMap';

// Matches tms-backend's DeviceType enum exactly (com.tmsbackend.domain.model.DeviceType).
export type BackendDeviceType = 'IRTCC' | 'DEVICE_2243';

// Payload shape matches tms-backend's POST /tms/api/readings/batch exactly
// (see ReadingBatchRequestDto on the backend) - one call every 60s covering
// every currently-visible device, batching both the topology (so the
// backend's device list stays in sync with whatever's configured in
// Settings) and each device's latest decoded reading together.
export interface ReadingsPushDeviceEntry {
  id: string;
  name: string;
  slaveId: number;
  deviceType: BackendDeviceType;
  enabled: boolean;
  irtccReading?: (DashboardReadings & { recordedAt: string }) | null;
  device2243Reading?: (Device2243Readings & { recordedAt: string }) | null;
}

export interface ReadingsPushGatewayEntry {
  id: string;
  name: string;
  clientId: number;
  ipAddress: string;
  port: number;
  devices: ReadingsPushDeviceEntry[];
}

export interface ReadingsPushTransformerEntry {
  id: string;
  name: string;
  gateways: ReadingsPushGatewayEntry[];
}

export interface ReadingsPushRequest {
  transformers: ReadingsPushTransformerEntry[];
}

// Fire-and-forget: a failed push (backend unreachable, offline, etc.) must
// never disrupt the live dashboard - it just means this minute's snapshot
// is missing from history, which is acceptable and will resume on the next
// successful tick.
export const pushReadingsBatchAsync = createAsyncThunk<void, ReadingsPushRequest, { extra: Dependencies }>(
  'readingsPush/pushBatch',
  async (request, { extra }) => {
    try {
      await extra.infrastructure.apiClient.post('/tms/api/readings/batch', request);
    } catch {
      // Swallowed - see comment above.
    }
  }
);

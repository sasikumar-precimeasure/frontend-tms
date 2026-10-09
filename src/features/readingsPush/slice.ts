import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { AxiosError } from 'axios';
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

// Fire-and-forget for the dashboard: a failed push (backend unreachable,
// offline, rejected) must never disrupt live readings - it only means this
// minute's snapshot is missing from history. But it is no longer silent:
// the outcome is kept in state (shown in Settings > Data Sync) and logged to
// the browser console, since a rejected push means the Data Log and monthly
// report quietly stop getting data.
export const pushReadingsBatchAsync = createAsyncThunk<void, ReadingsPushRequest, { extra: Dependencies; rejectValue: string }>(
  'readingsPush/pushBatch',
  async (request, { extra, rejectWithValue }) => {
    try {
      await extra.infrastructure.apiClient.post('/tms/api/readings/batch', request);
    } catch (error) {
      const data = error instanceof AxiosError ? (error.response?.data as { message?: string } | undefined) : undefined;
      const status = error instanceof AxiosError ? error.response?.status : undefined;
      const message = data?.message ?? (error instanceof Error ? error.message : 'Unknown error');
      console.warn(`[TMS] Readings push failed${status ? ` (HTTP ${status})` : ''}: ${message}`);
      return rejectWithValue(status ? `HTTP ${status}: ${message}` : message);
    }
  }
);

interface ReadingsPushState {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  failuresInARow: number;
}

const initialState: ReadingsPushState = { lastAttemptAt: null, lastSuccessAt: null, lastError: null, failuresInARow: 0 };

const readingsPushSlice = createSlice({
  name: 'readingsPush',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(pushReadingsBatchAsync.fulfilled, (state) => {
        const now = new Date().toISOString();
        state.lastAttemptAt = now;
        state.lastSuccessAt = now;
        state.lastError = null;
        state.failuresInARow = 0;
      })
      .addCase(pushReadingsBatchAsync.rejected, (state, action) => {
        state.lastAttemptAt = new Date().toISOString();
        state.lastError = action.payload ?? action.error.message ?? 'Push failed';
        state.failuresInARow += 1;
      });
  },
});

export default readingsPushSlice.reducer;

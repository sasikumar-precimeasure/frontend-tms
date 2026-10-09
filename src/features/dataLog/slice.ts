import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import type { Dependencies } from '../../app/dependencies';

// Mirrors tms-backend's DataLogDto.TopologyDto/GatewayDto/DeviceDto exactly
// - the backend's own stored topology (kept in sync by the 1-minute
// ingestion push), not the frontend's local Connection Settings state,
// since the Data Log reflects what's actually been persisted server-side.
export interface DataLogDevice {
  id: string;
  name: string;
  deviceType: 'IRTCC' | 'DEVICE_2243';
  // Newest stored reading (null = nothing stored) - used to hide empty
  // leftovers from older setups and to label the ones that have history.
  lastReadingAt: string | null;
}

export interface DataLogGateway {
  id: string;
  name: string;
  devices: DataLogDevice[];
}

export interface DataLogTransformer {
  id: string;
  name: string;
  gateways: DataLogGateway[];
}

export const fetchDataLogTopologyAsync = createAsyncThunk<DataLogTransformer[], void, { extra: Dependencies }>(
  'dataLog/fetchTopology',
  async (_, { extra }) => {
    const response = await extra.infrastructure.apiClient.get<DataLogTransformer[]>('/tms/api/data-log/topology');
    return response.data;
  }
);

// Mirrors tms-backend's DataLogDto.IrtccReadingRowDto - field names match
// tms/src/domain/entities/TransformerRegisterMap.ts's DashboardReadings 1:1
// (minus the annunciation arrays, which the Data Log table doesn't show).
export interface IrtccDataLogRow {
  recordedAt: string;
  otiTemperature: number | null;
  otiTemperatureMax: number | null;
  wtiTemperature: number | null;
  wtiTemperatureMax: number | null;
  mog: number | null;
  tapPosition: number | null;
  tapPositionMax: number | null;
  tapCount: number | null;
  ptVoltage: number | null;
  actualPtVoltage: number | null;
  operationMode: string | null;
  lvBreakerActive: boolean | null;
  hvBreakerActive: boolean | null;
  oltcLocal: boolean | null;
  ptFailActive: boolean | null;
  hooterActive: boolean | null;
  muteVisible: boolean | null;
  avrModeIsAuto: boolean | null;
  controlFailActive: boolean | null;
  afrActive: boolean | null;
  raiseRelayActive: boolean | null;
  lowerRelayActive: boolean | null;
  overVoltActive: boolean | null;
  underVoltActive: boolean | null;
  avrPtRatio: number | null;
  avrSetVoltage: number | null;
  avrRaiseRelayVoltage: number | null;
  avrLowRelayVoltage: number | null;
  avrHsForwardVoltage: number | null;
  avrHsBackwardVoltage: number | null;
  avrOverVoltage: number | null;
  avrUnderVoltage: number | null;
  avrPtFailSetpoint: number | null;
  avrInitialTime: number | null;
  avrSequentialTime: number | null;
  avrHighFwdBwdTime: number | null;
  avrControlFailTime: number | null;
  avrRelayMomentaryTime: number | null;
}

// Mirrors tms-backend's DataLogDto.Device2243ReadingRowDto.
export interface Device2243DataLogRow {
  recordedAt: string;
  otiTemperature: number | null;
  wtiTemperature: number | null;
  otiAlarmSetpoint: number | null;
  otiAlarmDiff: number | null;
  otiTripSetpoint: number | null;
  otiTripDiff: number | null;
  wtiAlarmSetpoint: number | null;
  wtiAlarmDiff: number | null;
  wtiTripSetpoint: number | null;
  wtiTripDiff: number | null;
  wtiFan1Setpoint: number | null;
  wtiFan1Diff: number | null;
  wtiFan2Setpoint: number | null;
  wtiFan2Diff: number | null;
  relayDelay: number | null;
}

export interface PagedDataLog<T> {
  items: T[];
  totalItems: number;
  totalPages: number;
  page: number;
  pageSize: number;
}

export interface FetchDataLogPageParams {
  deviceId: string;
  deviceType: 'IRTCC' | 'DEVICE_2243';
  from: string;
  to: string;
  page: number;
  pageSize: number;
}

export const fetchDataLogPageAsync = createAsyncThunk<
  PagedDataLog<IrtccDataLogRow> | PagedDataLog<Device2243DataLogRow>,
  FetchDataLogPageParams,
  { extra: Dependencies }
>('dataLog/fetchPage', async (params, { extra }) => {
  const path = params.deviceType === 'IRTCC' ? 'irtcc' : 'device2243';
  const response = await extra.infrastructure.apiClient.get(`/tms/api/data-log/${path}/${params.deviceId}`, {
    params: { from: params.from, to: params.to, page: params.page, pageSize: params.pageSize },
  });
  return response.data;
});

// Triggers a browser file download from the returned blob rather than
// updating any Redux state - dispatched like any other thunk (so it reuses
// the store's authenticated apiClient via the thunk `extra` argument) but
// has no corresponding case in extraReducers below, same as
// recordAuditEventAsync in auditLog/slice.ts.
export const exportDataLogAsync = createAsyncThunk<
  void,
  { deviceId: string; deviceType: 'IRTCC' | 'DEVICE_2243'; from: string; to: string; deviceName: string },
  { extra: Dependencies }
>('dataLog/export', async (params, { extra }) => {
  const path = params.deviceType === 'IRTCC' ? 'irtcc' : 'device2243';
  const response = await extra.infrastructure.apiClient.get(`/tms/api/data-log/${path}/${params.deviceId}/export`, {
    params: { from: params.from, to: params.to },
    responseType: 'blob',
  });
  const blob = new Blob([response.data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const safeName = params.deviceName.replace(/[^a-z0-9-_]+/gi, '_');
  link.download = `${safeName}-data-log.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
});

interface DataLogState {
  transformers: DataLogTransformer[];
  topologyLoaded: boolean;
}

const initialState: DataLogState = {
  transformers: [],
  topologyLoaded: false,
};

const dataLogSlice = createSlice({
  name: 'dataLog',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder.addCase(fetchDataLogTopologyAsync.fulfilled, (state, action) => {
      state.transformers = action.payload;
      state.topologyLoaded = true;
    });
  },
});

export default dataLogSlice.reducer;

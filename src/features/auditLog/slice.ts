import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { Dependencies } from '../../app/dependencies';

// Matches tms-backend's AuditEventType enum exactly (see
// com.tmsbackend.domain.model.AuditEventType) - keep these two in sync by
// hand, there is no shared schema between the two repos.
export type AuditEventType =
  | 'LOGIN'
  | 'LOGOUT'
  | 'ANNUNCIATION_ACK'
  | 'AVR_MODE_CHANGE'
  | 'TAP_RAISE'
  | 'TAP_LOWER'
  | 'CONTROL_FAIL_RESET'
  | 'AVR_SETTING_CHANGE'
  | 'DEVICE2243_SETPOINT_CHANGE'
  | 'MAIL_CONFIG_CHANGE'
  | 'THRESHOLD_BREACH'
  | 'MAIL_SENT'
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_STATUS_CHANGED'
  | 'USER_DELETED'
  | 'ROLE_CREATED'
  | 'ROLE_DELETED';

export interface RecordAuditEventRequest {
  eventType: AuditEventType;
  deviceId?: string;
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  description: string;
}

// Matches tms-backend's AuditEventDto exactly - one row read back from the
// Audit Log viewer (Settings > Audit Log).
export interface AuditEvent {
  id: number;
  occurredAt: string;
  userId: number | null;
  deviceId: string | null;
  eventType: AuditEventType;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  description: string;
}

// POSTs to tms-backend's /tms/api/audit-events - the actor is taken from
// the caller's JWT there, never from this payload, so it can't be spoofed.
// Fire-and-forget from the caller's point of view: a failed audit post
// (backend down, offline, etc.) must never block or roll back the real
// Modbus write it's describing - errors are swallowed here rather than
// surfaced to the user, since the write itself already has its own
// error/toast handling.
export const recordAuditEventAsync = createAsyncThunk<void, RecordAuditEventRequest, { extra: Dependencies }>(
  'auditLog/recordAuditEvent',
  async (request, { extra }) => {
    try {
      await extra.infrastructure.apiClient.post('/tms/api/audit-events', request);
    } catch {
      // Swallowed - see comment above. Nothing to update in Redux state
      // either way, so there's no reducer for this thunk's outcome.
    }
  }
);

// Backs the Audit Log viewer (Settings > Audit Log) - unlike
// recordAuditEventAsync, failures here ARE surfaced (see
// AuditLogCard.tsx's loadError), since this is a user-initiated read, not a
// background side-effect of some other action. Gated server-side on the
// caller's own read permission for the "Audit Log" menu (see
// PermissionGuard.requireRead) - a 403 here means the account lacks that
// permission, not that the request was malformed.
export const fetchAuditEventsAsync = createAsyncThunk<
  AuditEvent[],
  { deviceId?: string; limit?: number; from?: string; to?: string } | undefined,
  { extra: Dependencies }
>('auditLog/fetchEvents', async (params, { extra }) => {
  const url = params?.deviceId ? `/tms/api/audit-events/device/${params.deviceId}` : '/tms/api/audit-events';
  const response = await extra.infrastructure.apiClient.get<AuditEvent[]>(url, {
    params: { limit: params?.limit ?? 200, from: params?.from, to: params?.to },
  });
  return response.data;
});

interface AuditLogState {
  events: AuditEvent[];
  isLoaded: boolean;
}

const initialState: AuditLogState = {
  events: [],
  isLoaded: false,
};

const auditLogSlice = createSlice({
  name: 'auditLog',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder.addCase(fetchAuditEventsAsync.fulfilled, (state, action) => {
      state.events = action.payload;
      state.isLoaded = true;
    });
  },
});

export default auditLogSlice.reducer;

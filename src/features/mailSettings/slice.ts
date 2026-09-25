import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { MailRecipient, MailSenderSettings, MailThresholds } from '../../domain/entities/MailSettings';
import { DEFAULT_MAIL_SENDER_SETTINGS } from '../../domain/entities/MailSettings';
import type { Dependencies } from '../../app/dependencies';

interface MailSettingsState {
  sender: MailSenderSettings;
  recipients: MailRecipient[];
  isLoaded: boolean;
}

const initialState: MailSettingsState = {
  sender: { ...DEFAULT_MAIL_SENDER_SETTINGS },
  recipients: [],
  isLoaded: false,
};

// tms-backend is the real source of truth now (see
// infrastructure/web/controller/MailSettingsController.java) - the
// scheduled EvaluateMailThresholdsUseCase job on the backend reads directly
// from its own database, so anything only saved to localStorage would never
// actually affect what mail gets sent. These thunks call the backend
// directly; there is no local-only fallback path anymore.

export const fetchMailSettingsAsync = createAsyncThunk<
  { sender: MailSenderSettings; recipients: MailRecipient[] },
  void,
  { extra: Dependencies }
>('mailSettings/fetch', async (_, { extra }) => {
  const client = extra.infrastructure.apiClient;
  const [senderRes, recipientsRes] = await Promise.all([
    client.get<MailSenderSettings>('/tms/api/mail-settings/sender'),
    client.get<MailRecipient[]>('/tms/api/mail-settings/recipients'),
  ]);
  return { sender: senderRes.data, recipients: recipientsRes.data };
});

export const saveSenderSettingsAsync = createAsyncThunk<MailSenderSettings, MailSenderSettings, { extra: Dependencies }>(
  'mailSettings/saveSender',
  async (settings, { extra }) => {
    await extra.infrastructure.apiClient.put('/tms/api/mail-settings/sender', settings);
    return settings;
  }
);

// Backs both "add" (id === '') and "edit" (id set) - the backend's
// saveRecipient upserts by id, generating a fresh one server-side when
// blank, same pattern as the rest of this app's nanoid-on-the-client
// entities except the id now comes from the backend on first save.
export const saveRecipientAsync = createAsyncThunk<
  MailRecipient,
  { id?: string; name: string; email: string; enabled: boolean; deviceIds: string[] },
  { extra: Dependencies }
>('mailSettings/saveRecipient', async (recipient, { extra }) => {
  const response = await extra.infrastructure.apiClient.post<MailRecipient>('/tms/api/mail-settings/recipients', {
    id: recipient.id ?? '',
    name: recipient.name,
    email: recipient.email,
    enabled: recipient.enabled,
    deviceIds: recipient.deviceIds,
  });
  return response.data;
});

export const deleteRecipientAsync = createAsyncThunk<{ id: string }, { id: string }, { extra: Dependencies }>(
  'mailSettings/deleteRecipient',
  async ({ id }, { extra }) => {
    await extra.infrastructure.apiClient.delete(`/tms/api/mail-settings/recipients/${id}`);
    return { id };
  }
);

// Saves one device's alert thresholds to tms-backend - this is what the
// scheduled EvaluateMailThresholdsUseCase job actually reads on its next
// tick, distinct from (though also mirrored into) the local
// SubDevice.mailThresholds copy in connectionSettings/slice.ts.
export const saveMailThresholdsAsync = createAsyncThunk<void, MailThresholds & { deviceId: string }, { extra: Dependencies }>(
  'mailSettings/saveThresholds',
  async (thresholds, { extra }) => {
    await extra.infrastructure.apiClient.put('/tms/api/mail-settings/thresholds', thresholds);
  }
);

const mailSettingsSlice = createSlice({
  name: 'mailSettings',
  initialState,
  reducers: {
    // Optimistic, purely-local toggles for snappy checkboxes - each is
    // immediately followed by a saveRecipientAsync dispatch from the
    // component to persist the change; see MailConfigurationCard.tsx.
    toggleRecipientEnabledLocal: (state, action: PayloadAction<{ id: string }>) => {
      const recipient = state.recipients.find((r) => r.id === action.payload.id);
      if (recipient) recipient.enabled = !recipient.enabled;
    },
    toggleRecipientDeviceLocal: (state, action: PayloadAction<{ id: string; deviceId: string }>) => {
      const recipient = state.recipients.find((r) => r.id === action.payload.id);
      if (!recipient) return;
      const index = recipient.deviceIds.indexOf(action.payload.deviceId);
      if (index >= 0) {
        recipient.deviceIds.splice(index, 1);
      } else {
        recipient.deviceIds.push(action.payload.deviceId);
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchMailSettingsAsync.fulfilled, (state, action) => {
        state.sender = action.payload.sender;
        state.recipients = action.payload.recipients;
        state.isLoaded = true;
      })
      .addCase(saveSenderSettingsAsync.fulfilled, (state, action) => {
        // The backend never echoes the real password back (see
        // MailSenderSettingsDto.from) - keep whatever the form just sent
        // rather than overwriting local state with the blanked-out value,
        // so the field doesn't visibly clear itself right after saving.
        state.sender = { ...action.payload };
      })
      .addCase(saveRecipientAsync.fulfilled, (state, action) => {
        const index = state.recipients.findIndex((r) => r.id === action.payload.id);
        if (index >= 0) {
          state.recipients[index] = action.payload;
        } else {
          state.recipients.push(action.payload);
        }
      })
      .addCase(deleteRecipientAsync.fulfilled, (state, action) => {
        state.recipients = state.recipients.filter((r) => r.id !== action.payload.id);
      });
  },
});

export const { toggleRecipientEnabledLocal, toggleRecipientDeviceLocal } = mailSettingsSlice.actions;
export default mailSettingsSlice.reducer;

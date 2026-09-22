import { createSlice, nanoid } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { MailRecipient, MailSenderSettings } from '../../domain/entities/MailSettings';
import { DEFAULT_MAIL_SENDER_SETTINGS } from '../../domain/entities/MailSettings';

interface MailSettingsState {
  sender: MailSenderSettings;
  recipients: MailRecipient[];
}

const PERSIST_KEY = 'tms-mail-settings';

function loadPersistedState(): MailSettingsState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MailSettingsState>;
    if (!parsed.sender || !Array.isArray(parsed.recipients)) return null;
    return { sender: parsed.sender, recipients: parsed.recipients };
  } catch {
    // Corrupt/stale localStorage content - fall back to defaults rather
    // than crashing the app on load.
    return null;
  }
}

export function persistMailSettings(state: MailSettingsState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify(state));
  } catch {
    // Storage full/unavailable (private browsing, quota) - settings just
    // won't persist this session; not worth surfacing to the user.
  }
}

const initialState: MailSettingsState = loadPersistedState() ?? {
  sender: { ...DEFAULT_MAIL_SENDER_SETTINGS },
  recipients: [],
};

const mailSettingsSlice = createSlice({
  name: 'mailSettings',
  initialState,
  reducers: {
    updateSender: (state, action: PayloadAction<MailSenderSettings>) => {
      state.sender = action.payload;
    },
    addRecipient: (state, action: PayloadAction<{ name: string; email: string }>) => {
      const newRecipient: MailRecipient = {
        id: nanoid(),
        name: action.payload.name,
        email: action.payload.email,
        enabled: true,
        deviceIds: [],
      };
      state.recipients.push(newRecipient);
    },
    updateRecipient: (
      state,
      action: PayloadAction<{ id: string; name: string; email: string }>
    ) => {
      const recipient = state.recipients.find((r) => r.id === action.payload.id);
      if (recipient) {
        recipient.name = action.payload.name;
        recipient.email = action.payload.email;
      }
    },
    removeRecipient: (state, action: PayloadAction<{ id: string }>) => {
      state.recipients = state.recipients.filter((r) => r.id !== action.payload.id);
    },
    toggleRecipientEnabled: (state, action: PayloadAction<{ id: string }>) => {
      const recipient = state.recipients.find((r) => r.id === action.payload.id);
      if (recipient) recipient.enabled = !recipient.enabled;
    },
    // Per-device opt-in, a deliberate refinement of Form1.txt's coarser
    // per-TR (tr1/tr2) checkboxes - toggles whether this recipient receives
    // alerts for one specific device.
    toggleRecipientDevice: (state, action: PayloadAction<{ id: string; deviceId: string }>) => {
      const recipient = state.recipients.find((r) => r.id === action.payload.id);
      if (!recipient) return;
      const index = recipient.deviceIds.indexOf(action.payload.deviceId);
      if (index >= 0) {
        recipient.deviceIds.splice(index, 1);
      } else {
        recipient.deviceIds.push(action.payload.deviceId);
      }
    },
    // Removes a device id from every recipient's opt-in list - call this
    // when a device is deleted so stale ids don't linger in the list.
    removeDeviceFromAllRecipients: (state, action: PayloadAction<{ deviceId: string }>) => {
      state.recipients.forEach((recipient) => {
        recipient.deviceIds = recipient.deviceIds.filter((id) => id !== action.payload.deviceId);
      });
    },
  },
});

export const {
  updateSender,
  addRecipient,
  updateRecipient,
  removeRecipient,
  toggleRecipientEnabled,
  toggleRecipientDevice,
  removeDeviceFromAllRecipients,
} = mailSettingsSlice.actions;
export default mailSettingsSlice.reducer;

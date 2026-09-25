import { createSlice, nanoid } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

// A device-targeted alert shown as a banner at the top of the screen -
// distinct from the bottom-right toast (features/toast/slice.ts), which is
// for routine "your save succeeded" confirmations. This is for something
// that happened elsewhere in the app (an annunciation ack) that the user may
// want to jump straight to, from any screen.
export interface AppNotification {
  id: string;
  message: string;
  trId: string;
  deviceId: string;
}

interface NotificationsState {
  notifications: AppNotification[];
  // Set when a notification banner is clicked; DashboardPage/DevicePanel
  // read this to select the right transformer and auto-open that device's
  // settings drawer, then clear it once handled - a one-shot handoff, not
  // persistent "currently open drawer" state.
  pendingDrawerTarget: { trId: string; deviceId: string } | null;
}

const initialState: NotificationsState = {
  notifications: [],
  pendingDrawerTarget: null,
};

const notificationsSlice = createSlice({
  name: 'notifications',
  initialState,
  reducers: {
    showNotification: {
      reducer: (state, action: PayloadAction<AppNotification>) => {
        state.notifications.push(action.payload);
      },
      prepare: (message: string, trId: string, deviceId: string) => ({
        payload: { id: nanoid(), message, trId, deviceId },
      }),
    },
    dismissNotification: (state, action: PayloadAction<{ id: string }>) => {
      state.notifications = state.notifications.filter((n) => n.id !== action.payload.id);
    },
    openDrawerFor: (state, action: PayloadAction<{ trId: string; deviceId: string }>) => {
      state.pendingDrawerTarget = action.payload;
    },
    clearPendingDrawerTarget: (state) => {
      state.pendingDrawerTarget = null;
    },
  },
});

export const { showNotification, dismissNotification, openDrawerFor, clearPendingDrawerTarget } = notificationsSlice.actions;
export default notificationsSlice.reducer;

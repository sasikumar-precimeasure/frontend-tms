import type { Middleware } from '@reduxjs/toolkit';
import { isFulfilled, isRejected } from '@reduxjs/toolkit';
import { writeRegisterAsync } from '../../features/dashboard/slice';
import { showToast } from '../../features/toast/slice';

// Shows a toast after every register write (AVR Settings, 2243 setpoints,
// annunciation ack, AVR mode/tap controls, ...) resolves - a middleware
// rather than changes at each call site, since writeRegisterAsync is
// dispatched fire-and-forget from many different components and a listener
// here catches every one of them the same way, in one place.
export const toastMiddleware: Middleware = (store) => (next) => (action) => {
  const result = next(action);

  if (isFulfilled(writeRegisterAsync)(action)) {
    if (action.payload.errorMessage) {
      store.dispatch(showToast(action.payload.errorMessage, 'error'));
    } else {
      store.dispatch(showToast('Value updated successfully', 'success'));
    }
  } else if (isRejected(writeRegisterAsync)(action)) {
    const payload = action.payload as { message?: string } | undefined;
    store.dispatch(showToast(payload?.message ?? 'Failed to update value', 'error'));
  }

  return result;
};

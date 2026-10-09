import { createSlice } from '@reduxjs/toolkit';
import { gatewayServiceUnreachable, liveSnapshotReceived } from '../live/actions';

// Status of the readings push to tms-backend (Data Log history, monthly
// report, alarm emails). The push itself is done by the gateway service
// every push interval - independent of this browser tab - and reported in
// its live snapshot; shown in Settings > Data Sync.
interface ReadingsPushState {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  failuresInARow: number;
  // Set while the gateway service itself can't be reached - then nothing is
  // being polled or pushed at all.
  serviceUnreachable: string | null;
}

const initialState: ReadingsPushState = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  failuresInARow: 0,
  serviceUnreachable: null,
};

const readingsPushSlice = createSlice({
  name: 'readingsPush',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(liveSnapshotReceived, (state, action) => {
        Object.assign(state, action.payload.snapshot.push);
        state.serviceUnreachable = null;
      })
      .addCase(gatewayServiceUnreachable, (state, action) => {
        state.serviceUnreachable = action.payload;
      });
  },
});

export default readingsPushSlice.reducer;

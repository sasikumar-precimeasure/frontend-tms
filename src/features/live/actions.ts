import { createAction } from '@reduxjs/toolkit';
import type { LiveDeviceReading, LiveSnapshot } from '../../domain/entities/Modbus';

// Dispatched once a second with the gateway service's latest snapshot.
// devicesByReadingKey re-keys the snapshot's devices to the dashboard's
// `${trId}:${deviceId}` keys. Handled by connectionSettings (gateway
// connection states), dashboard (device readings) and readingsPush (backend
// push status).
export const liveSnapshotReceived = createAction<{
  snapshot: LiveSnapshot;
  devicesByReadingKey: Record<string, LiveDeviceReading>;
}>('live/snapshotReceived');

// The gateway service itself didn't answer (not running / crashed).
export const gatewayServiceUnreachable = createAction<string>('live/gatewayServiceUnreachable');

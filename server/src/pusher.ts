// Sends every device's latest reading to tms-backend every
// readingsPushIntervalSeconds (Data Log history, monthly report, alarm
// emails) - from here rather than the browser, so history keeps filling
// with the tab minimized or closed. Authenticates with a shared ingest key
// (TMS_INGEST_KEY, matching the backend's INGEST_API_KEY) since no user is
// logged in here.
import { mapRegistersToReadings, type TransformerRegisterConfig } from '../../src/domain/entities/TransformerRegisterMap';
import { map2243RegistersToReadings, type Device2243RegisterConfig } from '../../src/domain/entities/Device2243RegisterMap';
import type { TmsConfig } from './config';
import type { Poller } from './poller';
import { logger } from './logger';
import { BACKEND_URL, INGEST_KEY } from './env';

const REQUEST_TIMEOUT_MS = 15_000;
// A reading older than this isn't "the current value" any more - the device
// stopped answering - so it's left out instead of being stored again under
// a new timestamp.
const MAX_READING_AGE_MS = 10_000;

export interface PushStatus {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  failuresInARow: number;
}

// The backend stores numbers only. A sensor reading "open" (disconnected /
// out of range) is stored as "no value" - sending the text 'open' gets the
// whole batch rejected.
function withoutOpenSentinels<T extends object>(readings: T): T {
  return Object.fromEntries(Object.entries(readings).map(([key, value]) => [key, value === 'open' ? null : value])) as T;
}

export function buildBatch(config: TmsConfig, poller: Poller, now: Date) {
  const recordedAt = now.toISOString();
  const fresh = (deviceId: string) => {
    const live = poller.latestReading(deviceId);
    if (!live?.registers || !live.lastSuccessAt) return null;
    return now.getTime() - new Date(live.lastSuccessAt).getTime() <= MAX_READING_AGE_MS ? live.registers : null;
  };

  return {
    transformers: config.transformers.map((tr) => ({
      id: tr.id,
      name: tr.name,
      gateways: tr.gateways.map((gw) => ({
        id: gw.id,
        name: gw.name,
        clientId: gw.clientId,
        ipAddress: gw.ipAddress,
        port: gw.port,
        devices: gw.subDevices
          .filter((device) => device.enabled)
          .map((device) => {
            const registers = fresh(device.id);
            const base = { id: device.id, name: device.name, slaveId: device.slaveId, enabled: device.enabled };
            if (device.deviceType === '2243') {
              const offsets = (device.registerConfig as Device2243RegisterConfig).offsets;
              return {
                ...base,
                deviceType: 'DEVICE_2243' as const,
                device2243Reading: registers ? { ...withoutOpenSentinels(map2243RegistersToReadings(registers, offsets)), recordedAt } : null,
              };
            }
            const offsets = (device.registerConfig as TransformerRegisterConfig).offsets;
            return {
              ...base,
              deviceType: 'IRTCC' as const,
              irtccReading: registers ? { ...withoutOpenSentinels(mapRegistersToReadings(registers, offsets)), recordedAt } : null,
            };
          }),
      })),
    })),
  };
}

export class Pusher {
  private timer: NodeJS.Timeout | null = null;
  private intervalSeconds = 0;
  private running = false;
  readonly status: PushStatus = { lastAttemptAt: null, lastSuccessAt: null, lastError: null, failuresInARow: 0 };

  constructor(private readonly poller: Poller) {}

  // (Re)starts the timer when the interval changes; safe to call on every
  // config update.
  schedule(intervalSeconds: number): void {
    if (this.timer && intervalSeconds === this.intervalSeconds) return;
    if (this.timer) clearInterval(this.timer);
    this.intervalSeconds = intervalSeconds;
    this.timer = setInterval(() => void this.pushNow(), intervalSeconds * 1000);
    logger.info('push', 'Readings push scheduled', { everySeconds: intervalSeconds, backend: BACKEND_URL });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async pushNow(): Promise<void> {
    const config = this.poller.currentConfig;
    if (this.running || config.transformers.length === 0) return;
    this.running = true;
    const batch = buildBatch(config, this.poller, new Date());
    const devices = batch.transformers.flatMap((tr) => tr.gateways.flatMap((gw) => gw.devices));
    const withReading = devices.filter((d) => ('irtccReading' in d ? d.irtccReading : d.device2243Reading) !== null).length;
    this.status.lastAttemptAt = new Date().toISOString();
    try {
      const response = await fetch(`${BACKEND_URL}/tms/api/readings/batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ingest-key': INGEST_KEY },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(`HTTP ${response.status}${body?.message ? `: ${body.message}` : ''}`);
      }
      this.status.lastSuccessAt = this.status.lastAttemptAt;
      this.status.lastError = null;
      this.status.failuresInARow = 0;
      logger.info('push', 'Readings pushed to backend', { devices: devices.length, withReading });
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause?.code;
      this.status.lastError = `${(error as Error).message}${cause ? ` (${cause})` : ''}`;
      this.status.failuresInARow += 1;
      logger.warn('push', 'Readings push failed - this interval is missing from history', {
        error: this.status.lastError, failuresInARow: this.status.failuresInARow, backend: BACKEND_URL,
      });
    } finally {
      this.running = false;
    }
  }
}

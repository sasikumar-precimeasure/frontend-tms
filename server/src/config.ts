// The device configuration the gateway polls with: transformers -> gateways
// (TCP converters) -> devices (RS485 slaves) with their register maps,
// mirroring the website's Settings. The website edits it and uploads it
// here; the gateway persists it to disk so polling (and the readings push
// to the backend) keeps running after a restart with no browser open.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { TransformerRegisterConfig } from '../../src/domain/entities/TransformerRegisterMap';
import type { Device2243RegisterConfig } from '../../src/domain/entities/Device2243RegisterMap';
import { DATA_DIR } from './paths';
import { logger } from './logger';

export interface DeviceConfig {
  id: string;
  name: string;
  enabled: boolean;
  slaveId: number;
  deviceType: 'irtcc' | '2243';
  registerConfig: TransformerRegisterConfig | Device2243RegisterConfig;
}

export interface GatewayConfig {
  id: string;
  name: string;
  clientId: number;
  ipAddress: string;
  port: number;
  // false = the user clicked Disconnect (or is editing the address): don't
  // connect or poll until they click Connect again.
  autoConnect: boolean;
  busGroup?: string;
  subDevices: DeviceConfig[];
}

export interface TransformerConfig {
  id: string;
  name: string;
  gateways: GatewayConfig[];
}

export interface TmsConfig {
  // Milliseconds timestamp of the edit this config came from. An upload
  // with an older version is refused, so a browser tab left open with
  // outdated settings can't overwrite newer ones.
  version: number;
  readingsPushIntervalSeconds: number;
  transformers: TransformerConfig[];
}

export const MIN_PUSH_INTERVAL_SECONDS = 60;

const CONFIG_FILE = join(DATA_DIR, 'tms-config.json');

const EMPTY_CONFIG: TmsConfig = { version: 0, readingsPushIntervalSeconds: 60, transformers: [] };

export class InvalidConfigError extends Error {}

// Minimal shape check - enough that a malformed upload can't crash the
// poller; field-level validation stays in the website's Settings forms.
export function validateConfig(raw: unknown): TmsConfig {
  const c = raw as Partial<TmsConfig> | null;
  if (!c || typeof c !== 'object') throw new InvalidConfigError('config must be an object');
  if (typeof c.version !== 'number' || !Number.isFinite(c.version)) throw new InvalidConfigError('version must be a number');
  if (!Array.isArray(c.transformers)) throw new InvalidConfigError('transformers must be an array');
  for (const tr of c.transformers) {
    if (typeof tr?.id !== 'string' || !Array.isArray(tr.gateways)) throw new InvalidConfigError('invalid transformer');
    for (const gw of tr.gateways) {
      if (typeof gw?.id !== 'string' || typeof gw.ipAddress !== 'string' || typeof gw.port !== 'number' || !Array.isArray(gw.subDevices)) {
        throw new InvalidConfigError(`invalid gateway in ${tr.name ?? tr.id}`);
      }
      for (const d of gw.subDevices) {
        const rc = d?.registerConfig as { startAddress?: unknown; count?: unknown; offsets?: unknown } | undefined;
        if (typeof d?.id !== 'string' || typeof d.slaveId !== 'number' || !rc || typeof rc.startAddress !== 'number' || typeof rc.count !== 'number' || typeof rc.offsets !== 'object') {
          throw new InvalidConfigError(`invalid device in ${tr.name ?? tr.id} / ${gw.name ?? gw.id}`);
        }
      }
    }
  }
  return {
    version: c.version,
    readingsPushIntervalSeconds: Math.max(MIN_PUSH_INTERVAL_SECONDS, Number(c.readingsPushIntervalSeconds) || 60),
    transformers: c.transformers,
  };
}

export function loadConfig(): TmsConfig {
  try {
    const config = validateConfig(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')));
    logger.info('config', 'Loaded saved configuration', { file: CONFIG_FILE, version: config.version, ...summarize(config) });
    return config;
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    if (missing) {
      logger.info('config', 'No saved configuration yet - waiting for the website to upload one', { file: CONFIG_FILE });
    } else {
      logger.error('config', 'Saved configuration unreadable - starting empty until the website uploads one', {
        file: CONFIG_FILE, error: (error as Error).message,
      });
    }
    return EMPTY_CONFIG;
  }
}

// Written to a temp file then renamed, so a crash mid-write never leaves a
// half-written config behind.
export function saveConfig(config: TmsConfig): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${CONFIG_FILE}.tmp`;
  writeFileSync(temp, JSON.stringify(config, null, 2));
  renameSync(temp, CONFIG_FILE);
}

export function summarize(config: TmsConfig) {
  const gateways = config.transformers.flatMap((tr) => tr.gateways);
  return {
    transformers: config.transformers.length,
    gateways: gateways.length,
    devices: gateways.flatMap((gw) => gw.subDevices).filter((d) => d.enabled).length,
  };
}

export function allGateways(config: TmsConfig): { transformer: TransformerConfig; gateway: GatewayConfig }[] {
  return config.transformers.flatMap((transformer) => transformer.gateways.map((gateway) => ({ transformer, gateway })));
}

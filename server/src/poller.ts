// Owns every connection to the hardware and polls every enabled device once
// a second - in this Node process, so it keeps running when the browser tab
// is minimized (Chrome throttles a hidden tab's timers to about once a
// minute) or closed. The website only displays the latest values (see
// liveSnapshot) and sends configuration / connect / disconnect / writes.
import { ModbusClient, RS485Bus } from './ModbusClient';
import { allGateways, type DeviceConfig, type GatewayConfig, type TmsConfig } from './config';
import { logger } from './logger';

const POLL_INTERVAL_MS = 1000;
// Reconnect after a failed connect / dropped connection: right away the
// first time, then 5s, 10s, 20s ... capped at 60s; reset once connected.
const RECONNECT_BASE_DELAY_MS = 5000;
const RECONNECT_MAX_DELAY_MS = 60_000;

export interface LiveDevice {
  registers: number[] | null;
  errorMessage: string | null;
  lastReadAt: string | null;
  lastSuccessAt: string | null;
}

export type GatewayStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface LiveGateway {
  status: GatewayStatus;
  isConnected: boolean;
  isConnecting: boolean;
  errorMessage: string | null;
}

interface GatewayRuntime {
  connecting: boolean;
  failures: number;
  nextAttemptAt: number;
  errorMessage: string | null;
}

function endpointKey(gateway: GatewayConfig): string {
  return `${gateway.ipAddress.trim()}:${gateway.port}`;
}

function isActive(gateway: GatewayConfig): boolean {
  return gateway.autoConnect && gateway.ipAddress.trim() !== '';
}

export class Poller {
  private config: TmsConfig;
  private readonly endpoints = new Map<string, ModbusClient>();
  private readonly buses = new Map<string, RS485Bus>();
  private readonly runtime = new Map<string, GatewayRuntime>();
  private readonly live = new Map<string, LiveDevice>();
  private readonly inFlight = new Set<string>();
  private nextConnectionId = 1;
  private timer: NodeJS.Timeout | null = null;

  constructor(config: TmsConfig) {
    this.config = config;
  }

  get currentConfig(): TmsConfig {
    return this.config;
  }

  start(): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const client of this.endpoints.values()) client.disconnect();
    this.endpoints.clear();
  }

  setConfig(config: TmsConfig): void {
    const before = new Map(allGateways(this.config).map(({ gateway }) => [gateway.id, gateway]));
    this.config = config;

    // A gateway whose address changed, or that was just (re)enabled, should
    // try right away rather than wait out an old backoff.
    for (const { gateway } of allGateways(config)) {
      const old = before.get(gateway.id);
      if (!old || endpointKey(old) !== endpointKey(gateway) || (!old.autoConnect && gateway.autoConnect)) {
        this.runtime.delete(gateway.id);
      }
    }

    // Forget devices that no longer exist, and close connections no active
    // gateway uses any more.
    const deviceIds = new Set(allGateways(config).flatMap(({ gateway }) => gateway.subDevices.map((d) => d.id)));
    for (const id of this.live.keys()) if (!deviceIds.has(id)) this.live.delete(id);
    this.releaseUnusedEndpoints();
  }

  // Connection for an on-demand read/write from the website (AVR settings,
  // alarm acknowledge, ...), looked up by the gateway's clientId.
  clientForClientId(clientId: number): ModbusClient | null {
    const entry = allGateways(this.config).find(({ gateway }) => gateway.clientId === clientId);
    if (!entry || !isActive(entry.gateway)) return null;
    return this.endpoints.get(endpointKey(entry.gateway)) ?? null;
  }

  liveSnapshot() {
    const gateways: Record<string, LiveGateway> = {};
    for (const { gateway } of allGateways(this.config)) gateways[gateway.id] = this.gatewayStatus(gateway);
    return { configVersion: this.config.version, gateways, devices: Object.fromEntries(this.live) };
  }

  latestReading(deviceId: string): LiveDevice | undefined {
    return this.live.get(deviceId);
  }

  diagnostics(resetWindow: boolean) {
    const usedBy = new Map<string, string[]>();
    for (const { transformer, gateway } of allGateways(this.config)) {
      if (!isActive(gateway)) continue;
      const key = endpointKey(gateway);
      usedBy.set(key, [...(usedBy.get(key) ?? []), `${transformer.name} / ${gateway.name}`]);
    }
    return [...this.endpoints.entries()].map(([key, client]) => ({ ...client.takeStats(resetWindow), usedBy: usedBy.get(key) ?? [] }));
  }

  private gatewayStatus(gateway: GatewayConfig): LiveGateway {
    if (!isActive(gateway)) return { status: 'disconnected', isConnected: false, isConnecting: false, errorMessage: null };
    const client = this.endpoints.get(endpointKey(gateway));
    const rt = this.runtime.get(gateway.id);
    if (client?.isConnected) return { status: 'connected', isConnected: true, isConnecting: false, errorMessage: null };
    if (rt?.connecting) return { status: 'connecting', isConnected: false, isConnecting: true, errorMessage: null };
    return {
      status: rt?.errorMessage ? 'error' : 'connecting',
      isConnected: false,
      isConnecting: !rt?.errorMessage,
      errorMessage: rt?.errorMessage ?? null,
    };
  }

  private runtimeFor(gateway: GatewayConfig): GatewayRuntime {
    let rt = this.runtime.get(gateway.id);
    if (!rt) {
      rt = { connecting: false, failures: 0, nextAttemptAt: 0, errorMessage: null };
      this.runtime.set(gateway.id, rt);
    }
    return rt;
  }

  private busFor(name: string | undefined): RS485Bus | null {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return null;
    const key = trimmed.toLowerCase();
    let bus = this.buses.get(key);
    if (!bus) {
      bus = new RS485Bus(trimmed);
      this.buses.set(key, bus);
    }
    return bus;
  }

  private releaseUnusedEndpoints(): void {
    const used = new Set(allGateways(this.config).filter(({ gateway }) => isActive(gateway)).map(({ gateway }) => endpointKey(gateway)));
    for (const [key, client] of this.endpoints) {
      if (!used.has(key)) {
        logger.info('poller', 'No active gateway uses this converter any more - closing its connection', { endpoint: key });
        client.disconnect();
        this.endpoints.delete(key);
      }
    }
  }

  private tick(): void {
    const active = allGateways(this.config).filter(({ gateway }) => isActive(gateway));

    // One connection per converter (ip:port), shared by every gateway that
    // points at it; its RS485 bus is the first bus name any of them gives.
    const busByEndpoint = new Map<string, string>();
    for (const { gateway } of active) {
      const key = endpointKey(gateway);
      if (!busByEndpoint.get(key) && gateway.busGroup?.trim()) busByEndpoint.set(key, gateway.busGroup);
    }

    for (const { transformer, gateway } of active) {
      const key = endpointKey(gateway);
      let client = this.endpoints.get(key);
      if (!client) {
        client = new ModbusClient(this.nextConnectionId++);
        this.endpoints.set(key, client);
        logger.info('poller', 'New converter connection', { conn: client.clientId, endpoint: key, for: `${transformer.name} / ${gateway.name}` });
      }
      if (!client.isConnected) {
        this.maybeConnect(gateway, client);
        continue;
      }
      // After connecting, so the log shows the converter's address; reads
      // only start once connected, so the bus is always in place first.
      client.setBus(this.busFor(busByEndpoint.get(key)));
      for (const device of gateway.subDevices) {
        if (device.enabled && !this.inFlight.has(device.id)) this.read(gateway, device, client);
      }
    }
  }

  private maybeConnect(gateway: GatewayConfig, client: ModbusClient): void {
    const rt = this.runtimeFor(gateway);
    if (rt.connecting || Date.now() < rt.nextAttemptAt) return;
    rt.connecting = true;
    client
      .connect(gateway.ipAddress.trim(), gateway.port)
      .then(() => {
        rt.failures = 0;
        rt.nextAttemptAt = 0;
        rt.errorMessage = null;
      })
      .catch((error: Error) => {
        rt.failures += 1;
        rt.errorMessage = error.message.startsWith('Connect') ? error.message : `Connect: ${error.message}`;
        rt.nextAttemptAt = Date.now() + Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** (rt.failures - 1));
      })
      .finally(() => {
        rt.connecting = false;
      });
  }

  private read(gateway: GatewayConfig, device: DeviceConfig, client: ModbusClient): void {
    this.inFlight.add(device.id);
    const { startAddress, count } = device.registerConfig;
    client
      .readHoldingRegisters(device.slaveId, startAddress, count)
      .then((registers) => {
        const now = new Date().toISOString();
        this.live.set(device.id, { registers, errorMessage: null, lastReadAt: now, lastSuccessAt: now });
      })
      .catch((error: Error) => {
        const previous = this.live.get(device.id);
        this.live.set(device.id, {
          registers: null,
          errorMessage: error.message,
          lastReadAt: new Date().toISOString(),
          lastSuccessAt: previous?.lastSuccessAt ?? null,
        });
        if (!client.isConnected) {
          // The connection dropped (3 timeouts in a row, socket error, ...):
          // reconnect on the next tick, then back off if that fails too.
          const rt = this.runtimeFor(gateway);
          rt.errorMessage = error.message;
          rt.nextAttemptAt = 0;
        }
      })
      .finally(() => this.inFlight.delete(device.id));
  }
}

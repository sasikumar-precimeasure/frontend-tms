import express from 'express';
import type { Request } from 'express';
import cors from 'cors';
import { execFileSync } from 'child_process';
import { ModbusClient, RS485Bus } from './ModbusClient';
import type { ModbusStatus } from './ModbusClient';
import { logger } from './logger';

const PORT = Number(process.env.GATEWAY_PORT) || 4000;

const app = express();
app.use(cors());
app.use(express.json());

// Requests slower than this are logged - the browser gives up at 8s
// (GATEWAY_REQUEST_TIMEOUT_MS in the frontend) and then treats the gateway
// as disconnected, so anything close to that is a likely cause of flapping.
const SLOW_HTTP_MS = 3000;

function shortTab(req: Request): string {
  return (req.get('x-tms-instance') || 'default').slice(0, 8);
}

// Every request at debug level; failures, slow requests and requests the
// browser abandoned (timed out) at warn level.
app.use((req, res, next) => {
  const startedAt = Date.now();
  const payload = Object.keys(req.body ?? {}).length > 0 ? req.body : req.query;
  let responseBody: unknown;

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    responseBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const fields = { tab: shortTab(req), status: res.statusCode, durationMs, request: payload };
    const errorMessage = (responseBody as { errorMessage?: string } | undefined)?.errorMessage;
    if (res.statusCode >= 400) {
      logger.warn('http', `${req.method} ${req.path} failed`, { ...fields, error: errorMessage });
    } else if (durationMs > SLOW_HTTP_MS) {
      logger.warn('http', `${req.method} ${req.path} slow`, fields);
    } else {
      logger.debug('http', `${req.method} ${req.originalUrl}`, fields);
    }
  });
  res.on('close', () => {
    if (!res.writableFinished) {
      logger.warn('http', `${req.method} ${req.path} abandoned by browser before reply (browser timeout?)`, {
        tab: shortTab(req), afterMs: Date.now() - startedAt, request: payload,
      });
    }
  });

  next();
});

// One TCP connection per physical endpoint (ip:port), shared by every
// clientId (UI gateway) pointing at it. Many RS485->TCP gateways (and the
// local simulator) accept only one or a few TCP clients at a time - opening
// a separate socket per UI gateway meant only one of them was ever served
// and the rest timed out, flapping between "connecting" and "not connected".
// The RS485 bus behind the endpoint is half-duplex anyway, so sharing one
// socket and queueing every request on it (ModbusClient serializes them) is
// both correct and faster.
interface Endpoint {
  key: string;
  client: ModbusClient;
  bindings: Set<string>;
}

const endpoints = new Map<string, Endpoint>();

// Shared RS485 buses by name (case-insensitive), from each gateway's
// "Shared RS485 bus" setting in the UI. Converters given the same bus name
// take turns - see RS485Bus.
const buses = new Map<string, RS485Bus>();

function busFor(name: string | undefined): RS485Bus | null {
  const trimmed = (name ?? '').trim();
  if (trimmed === '') return null;
  const key = trimmed.toLowerCase();
  let bus = buses.get(key);
  if (!bus) {
    bus = new RS485Bus(trimmed);
    buses.set(key, bus);
  }
  return bus;
}
// A binding is one UI gateway in one browser tab: `${instanceId}:${clientId}`.
// clientIds are only unique within one tab's saved settings - two tabs (or a
// stale tab still holding older settings) both use clientId 2 for their own
// TR2, and keying by clientId alone let them steal each other's connection.
const endpointKeyByBinding = new Map<string, string>();
const lastSeenByBinding = new Map<string, number>();
let nextEndpointId = 1;

// A tab that closes never sends disconnect - release bindings that haven't
// made any request for this long so their sockets don't stay open forever.
// Every connected binding is polled every second, so this never fires for
// a live tab.
const BINDING_IDLE_TIMEOUT_MS = 60_000;

function endpointKey(ipAddress: string, port: number): string {
  return `${ipAddress}:${port}`;
}

function bindingFor(req: Request, clientId: number): string {
  const instanceId = req.get('x-tms-instance') || 'default';
  return `${instanceId}:${clientId}`;
}

function getClient(binding: string): ModbusClient | null {
  const key = endpointKeyByBinding.get(binding);
  if (!key) return null;
  lastSeenByBinding.set(binding, Date.now());
  return endpoints.get(key)?.client ?? null;
}

// Binds a tab's gateway to the shared endpoint for ip:port, creating it on first use.
function acquireEndpoint(binding: string, ipAddress: string, port: number): ModbusClient {
  const key = endpointKey(ipAddress, port);
  if (endpointKeyByBinding.has(binding) && endpointKeyByBinding.get(binding) !== key) {
    releaseEndpoint(binding, `re-pointed to ${key}`);
  }

  let endpoint = endpoints.get(key);
  if (!endpoint) {
    endpoint = { key, client: new ModbusClient(nextEndpointId++), bindings: new Set() };
    endpoints.set(key, endpoint);
    logger.info('gateway', 'New endpoint (one shared TCP connection)', { conn: endpoint.client.clientId, endpoint: key });
  }
  if (!endpoint.bindings.has(binding)) {
    logger.info('gateway', 'Bound UI gateway to endpoint', {
      binding: shortBinding(binding), endpoint: key, sharedBy: endpoint.bindings.size + 1,
    });
  }
  endpoint.bindings.add(binding);
  endpointKeyByBinding.set(binding, key);
  lastSeenByBinding.set(binding, Date.now());
  return endpoint.client;
}

// Unbinds a tab's gateway; the socket itself is only closed once nothing uses it.
function releaseEndpoint(binding: string, reason = 'disconnect requested'): void {
  const key = endpointKeyByBinding.get(binding);
  if (!key) return;
  logger.info('gateway', 'Released UI gateway from endpoint', { binding: shortBinding(binding), endpoint: key, reason });
  endpointKeyByBinding.delete(binding);
  lastSeenByBinding.delete(binding);
  const endpoint = endpoints.get(key);
  if (!endpoint) return;
  endpoint.bindings.delete(binding);
  if (endpoint.bindings.size === 0) {
    logger.info('gateway', 'Endpoint no longer used - closing its connection', { endpoint: key });
    endpoint.client.disconnect();
    endpoints.delete(key);
  }
}

// "<tab-id first 8 chars>:<clientId>" - enough to tell tabs apart in logs.
function shortBinding(binding: string): string {
  const sep = binding.lastIndexOf(':');
  return `${binding.slice(0, Math.min(8, sep))}:${binding.slice(sep + 1)}`;
}

setInterval(() => {
  const cutoff = Date.now() - BINDING_IDLE_TIMEOUT_MS;
  for (const [binding, lastSeen] of lastSeenByBinding) {
    if (lastSeen < cutoff) {
      releaseEndpoint(binding, `idle for ${BINDING_IDLE_TIMEOUT_MS / 1000}s (tab closed?)`);
    }
  }
}, 15_000).unref();

// Health snapshot of every endpoint every 30s - the main thing to look at
// when a TR keeps going "not connected": timeouts/drops/latency per
// endpoint, plus how many UI gateways share each one.
const HEALTH_LOG_INTERVAL_MS = 30_000;

function diagnostics(resetWindow: boolean) {
  return [...endpoints.values()].map((endpoint) => ({
    ...endpoint.client.takeStats(resetWindow),
    bindings: [...endpoint.bindings].map(shortBinding),
  }));
}

setInterval(() => {
  for (const stats of diagnostics(true)) {
    const w = stats.window;
    logger.info('health', stats.connected ? 'Endpoint OK' : 'Endpoint DOWN', {
      endpoint: stats.endpoint,
      connected: stats.connected,
      uptimeSec: stats.uptimeSec,
      sharedBy: stats.bindings.length,
      bus: stats.bus ? `${stats.bus.name} (${stats.bus.waiting} waiting)` : undefined,
      last30s: `${w.ok}/${w.requests} ok, ${w.timeouts} timeouts, ${w.exceptions} exceptions, ${w.otherErrors} errors, ${w.drops} drops`,
      avgLatencyMs: w.ok ? Math.round(w.latencySumMs / w.ok) : undefined,
      maxLatencyMs: w.latencyMaxMs || undefined,
      queueDepth: stats.queueDepth,
      lastError: stats.lastError ? `${stats.lastError.message} @ ${stats.lastError.at}` : undefined,
    });
  }
}, HEALTH_LOG_INTERVAL_MS).unref();

function toConnectionPayload(clientId: number, client: ModbusClient | null, errorMessage: string | null) {
  const isConnected = client?.isConnected ?? false;
  const status: ModbusStatus = errorMessage ? 'error' : isConnected ? 'connected' : 'disconnected';
  return {
    clientId,
    ipAddress: client?.ipAddress ?? '',
    port: client?.port ?? 0,
    status,
    isConnected,
    errorMessage,
  };
}

// POST /api/modbus/connect  { clientId, ipAddress, port }
app.post('/api/modbus/connect', async (req, res) => {
  const { clientId, ipAddress, port, busGroup } = req.body as {
    clientId: number;
    ipAddress: string;
    port: number;
    busGroup?: string;
  };

  const client = acquireEndpoint(bindingFor(req, clientId), ipAddress, port);
  client.setBus(busFor(busGroup));
  let lastError: string | null = null;
  const offError = client.onErrorOccurred((event) => {
    lastError = event.errorMsg;
  });

  try {
    await client.connect(ipAddress, port);
    res.json(toConnectionPayload(clientId, client, null));
  } catch (ex) {
    const message = lastError ?? (ex instanceof Error ? ex.message : String(ex));
    res.status(502).json(toConnectionPayload(clientId, client, message));
  } finally {
    offError();
  }
});

// POST /api/modbus/disconnect  { clientId }
app.post('/api/modbus/disconnect', (req, res) => {
  const { clientId } = req.body as { clientId: number };
  releaseEndpoint(bindingFor(req, clientId));
  res.json(toConnectionPayload(clientId, null, null));
});

// GET /api/modbus/status/:clientId
app.get('/api/modbus/status/:clientId', (req, res) => {
  const clientId = Number(req.params.clientId);
  res.json(toConnectionPayload(clientId, getClient(bindingFor(req, clientId)), null));
});

// GET /api/modbus/read/:clientId?slaveId=1&startAddress=4001&count=80
app.get('/api/modbus/read/:clientId', async (req, res) => {
  const clientId = Number(req.params.clientId);
  const slaveId = Number(req.query.slaveId ?? 1);
  const startAddress = Number(req.query.startAddress ?? 0);
  const count = Number(req.query.count ?? 1);

  const client = getClient(bindingFor(req, clientId));
  if (!client) {
    // This tab never connected this clientId here, or the binding was
    // released (idle sweep / disconnect) or the gateway server restarted.
    logger.warn('gateway', 'Read for a UI gateway with no connection on this server', {
      binding: shortBinding(bindingFor(req, clientId)), slave: slaveId,
    });
    res.status(502).json({ clientId, slaveId, startAddress, registers: null, errorMessage: 'Read: Not connected', isConnected: false });
    return;
  }
  let lastError: string | null = null;
  const offError = client.onErrorOccurred((event) => {
    lastError = event.errorMsg;
  });

  try {
    const registers = await client.readHoldingRegisters(slaveId, startAddress, count);
    res.json({ clientId, slaveId, startAddress, registers, errorMessage: null, isConnected: client.isConnected });
  } catch (ex) {
    const message = lastError ?? (ex instanceof Error ? ex.message : String(ex));
    // isConnected reflects the client's state *after* the failed read - a
    // framing/timeout error tears the socket down (see ModbusClient), so
    // the frontend can tell "transient read error, still connected" apart
    // from "connection actually dropped, go reconnect" instead of retrying
    // forever against a dead socket.
    res
      .status(502)
      .json({ clientId, slaveId, startAddress, registers: null, errorMessage: message, isConnected: client.isConnected });
  } finally {
    offError();
  }
});

// POST /api/modbus/write  { clientId, slaveId, address, value }
app.post('/api/modbus/write', async (req, res) => {
  const { clientId, slaveId, address, value } = req.body as {
    clientId: number;
    slaveId: number;
    address: number;
    value: number;
  };

  const client = getClient(bindingFor(req, clientId));
  if (!client) {
    res.status(502).json({ clientId, address, value, errorMessage: 'Write: Not connected', isConnected: false });
    return;
  }
  let lastError: string | null = null;
  const offError = client.onErrorOccurred((event) => {
    lastError = event.errorMsg;
  });

  try {
    await client.writeSingleRegister(slaveId, address, value);
    res.json({ clientId, address, value, errorMessage: null, isConnected: client.isConnected });
  } catch (ex) {
    const message = lastError ?? (ex instanceof Error ? ex.message : String(ex));
    res.status(502).json({ clientId, address, value, errorMessage: message, isConnected: client.isConnected });
  } finally {
    offError();
  }
});

// GET /api/modbus/diagnostics - live view of every endpoint (doesn't reset
// the 30s health-log window).
app.get('/api/modbus/diagnostics', (_req, res) => {
  res.json({ now: new Date().toISOString(), endpoints: diagnostics(false) });
});

// Record why the gateway died, then exit exactly as Node would have anyway.
process.on('uncaughtException', (err) => {
  logger.fatal('process', 'Uncaught exception - exiting', { error: err.stack ?? err.message });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.fatal('process', 'Unhandled promise rejection - exiting', { error: reason instanceof Error ? reason.stack : String(reason) });
  process.exit(1);
});

// Best-effort lookup of whatever already holds the port, for the startup
// error message below.
function describePortOwner(port: number): string {
  try {
    if (process.platform === 'win32') {
      const line = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true })
        .split(/\r?\n/)
        .find((l) => /LISTENING/.test(l) && l.trim().split(/\s+/)[1]?.endsWith(`:${port}`));
      return line ? `PID ${line.trim().split(/\s+/).pop()}` : 'unknown process';
    }
    const pid = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split('\n')[0];
    const command = pid ? execFileSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' }).trim() : '';
    return pid ? `PID ${pid} (${command.slice(0, 100)})` : 'unknown process';
  } catch {
    return 'unknown process';
  }
}

const server = app.listen(PORT, () => {
  logger.info('gateway', `Modbus gateway listening on http://localhost:${PORT}`, {
    logLevel: process.env.LOG_LEVEL ?? 'info', logDir: logger.logDir, pid: process.pid,
  });
});

// Only ONE gateway may run per machine: it owns the TCP connections to the
// devices, and two copies would each open their own (many Modbus gateways
// only allow 1-2) and fight over them. The port doubles as the lock - if
// it's taken, say clearly why and exit instead of crashing obscurely.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    logger.fatal('gateway', `Port ${PORT} is already in use - another Modbus gateway is probably still running. This copy will NOT start.`, {
      heldBy: describePortOwner(PORT),
      fix: 'stop the old one first: "npm run dev:stop" (from the tms folder), or end that PID',
    });
  } else {
    logger.fatal('gateway', 'Could not start the HTTP server', { error: err.message, code: err.code });
  }
  process.exit(1);
});

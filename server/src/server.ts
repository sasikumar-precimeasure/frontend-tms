import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import { execFileSync } from 'child_process';
import type { ModbusClient } from './ModbusClient';
import { InvalidConfigError, loadConfig, saveConfig, summarize, validateConfig, type TmsConfig } from './config';
import { Poller } from './poller';
import { Pusher } from './pusher';
import { logger } from './logger';
import { requireWrite } from './auth';
import { GATEWAY_HOST } from './env';

const PORT = Number(process.env.GATEWAY_PORT) || 4000;

// The gateway server owns the hardware: it keeps the device configuration
// (uploaded by the website, saved to disk), connects to every converter,
// polls every device once a second and pushes readings to the backend -
// all independent of any browser tab. The website reads the latest values
// from /api/live and sends configuration changes, connect/disconnect and
// on-demand reads/writes.
const poller = new Poller(loadConfig());
const pusher = new Pusher(poller);

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Requests slower than this are logged - the browser gives up at 8s.
const SLOW_HTTP_MS = 3000;

// Every request at debug level; failures, slow requests and requests the
// browser abandoned (timed out) at warn level.
app.use((req, res, next) => {
  const startedAt = Date.now();
  const payload = req.path === '/api/config' ? '(config)' : Object.keys(req.body ?? {}).length > 0 ? req.body : req.query;
  let responseBody: unknown;

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    responseBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const fields = { status: res.statusCode, durationMs, request: payload };
    const body = responseBody as { errorMessage?: string; message?: string } | undefined;
    if (res.statusCode >= 400) {
      logger.warn('http', `${req.method} ${req.path} failed`, { ...fields, error: body?.errorMessage ?? body?.message });
    } else if (durationMs > SLOW_HTTP_MS) {
      logger.warn('http', `${req.method} ${req.path} slow`, fields);
    } else {
      logger.debug('http', `${req.method} ${req.originalUrl}`, fields);
    }
  });
  res.on('close', () => {
    if (!res.writableFinished) {
      logger.warn('http', `${req.method} ${req.path} abandoned by browser before reply (browser timeout?)`, {
        afterMs: Date.now() - startedAt, request: payload,
      });
    }
  });

  next();
});

function applyConfig(config: TmsConfig, reason: string): void {
  saveConfig(config);
  poller.setConfig(config);
  pusher.schedule(config.readingsPushIntervalSeconds);
  logger.info('config', `Configuration updated (${reason})`, { version: config.version, ...summarize(config) });
  // Push right away so the backend knows about new/renamed devices now -
  // e.g. Mail Configuration can save thresholds for a device added a
  // moment ago - instead of after a full push interval.
  void pusher.pushNow();
}

// GET /api/config - the configuration the gateway is polling with.
app.get('/api/config', (_req, res) => {
  res.json({ config: poller.currentConfig });
});

// PUT /api/config { config } - from the website's Settings. Refused (409,
// with the current config) when older than what's already here, so an
// outdated browser tab can't overwrite newer settings.
app.put('/api/config', requireWrite(() => ['Connection Settings']), (req, res) => {
  let incoming: TmsConfig;
  try {
    incoming = validateConfig((req.body as { config?: unknown })?.config);
  } catch (error) {
    if (error instanceof InvalidConfigError) {
      res.status(400).json({ message: `Invalid configuration: ${error.message}` });
      return;
    }
    throw error;
  }
  const current = poller.currentConfig;
  if (incoming.version < current.version) {
    logger.warn('config', 'Refused outdated configuration from a browser tab', { incoming: incoming.version, current: current.version });
    res.status(409).json({ message: 'These settings are older than the ones the gateway already has.', config: current });
    return;
  }
  if (incoming.version !== current.version) applyConfig(incoming, 'from website');
  res.json({ config: poller.currentConfig });
});

// POST /api/gateways/:id/connect | /disconnect - the Connect / Disconnect
// buttons. Stored in the config (autoConnect) so it survives restarts.
function setAutoConnect(req: Request, res: Response, autoConnect: boolean) {
  const current = poller.currentConfig;
  const found = current.transformers.some((tr) => tr.gateways.some((gw) => gw.id === req.params.id));
  if (!found) {
    res.status(404).json({ message: 'Unknown gateway - its settings have not reached the gateway service yet.' });
    return;
  }
  const next: TmsConfig = {
    ...current,
    version: Math.max(Date.now(), current.version + 1),
    transformers: current.transformers.map((tr) => ({
      ...tr,
      gateways: tr.gateways.map((gw) => (gw.id === req.params.id ? { ...gw, autoConnect } : gw)),
    })),
  };
  applyConfig(next, `${autoConnect ? 'connect' : 'disconnect'} ${req.params.id}`);
  res.json({ configVersion: next.version, gateway: poller.liveSnapshot().gateways[req.params.id] });
}
const connectionSettingsWrite = requireWrite(() => ['Connection Settings']);
app.post('/api/gateways/:id/connect', connectionSettingsWrite, (req, res) => setAutoConnect(req, res, true));
app.post('/api/gateways/:id/disconnect', connectionSettingsWrite, (req, res) => setAutoConnect(req, res, false));

// GET /api/live - latest value of every device, every gateway's connection
// state and the backend push status. Polled by the website once a second
// for display only.
app.get('/api/live', (_req, res) => {
  res.json({ ...poller.liveSnapshot(), push: pusher.status, serverTime: new Date().toISOString() });
});

// On-demand reads/writes from the website (AVR settings, alarm acknowledge,
// mode/tap commands), over the poller's own connection for that gateway.
function connectionOr502(clientId: number, res: Response, payload: Record<string, unknown>): ModbusClient | null {
  const client = poller.clientForClientId(clientId);
  if (!client?.isConnected) {
    res.status(502).json({ ...payload, errorMessage: 'Not connected', isConnected: false });
    return null;
  }
  return client;
}

// GET /api/modbus/read/:clientId?slaveId=1&startAddress=40001&count=80
app.get('/api/modbus/read/:clientId', async (req, res) => {
  const clientId = Number(req.params.clientId);
  const slaveId = Number(req.query.slaveId ?? 1);
  const startAddress = Number(req.query.startAddress ?? 0);
  const count = Number(req.query.count ?? 1);
  const payload = { clientId, slaveId, startAddress, registers: null };
  const client = connectionOr502(clientId, res, payload);
  if (!client) return;
  try {
    const registers = await client.readHoldingRegisters(slaveId, startAddress, count);
    res.json({ ...payload, registers, errorMessage: null, isConnected: client.isConnected });
  } catch (error) {
    res.status(502).json({ ...payload, errorMessage: (error as Error).message, isConnected: client.isConnected });
  }
});

// POST /api/modbus/write  { clientId, slaveId, address, value, menu }
// A command to the hardware: needs write permission on the screen it comes
// from (Dashboard controls, or AVR Settings setpoints).
const commandWrite = requireWrite((req) => [(req.body as { menu?: string })?.menu === 'AVR Settings' ? 'AVR Settings' : 'Dashboard']);
app.post('/api/modbus/write', commandWrite, async (req, res) => {
  const { clientId, slaveId, address, value } = req.body as { clientId: number; slaveId: number; address: number; value: number };
  const payload = { clientId, address, value };
  const client = connectionOr502(clientId, res, payload);
  if (!client) return;
  try {
    await client.writeSingleRegister(slaveId, address, value);
    logger.info('command', 'Register written', { user: res.locals.userName, clientId, slaveId, address, value });
    res.json({ ...payload, errorMessage: null, isConnected: client.isConnected });
  } catch (error) {
    res.status(502).json({ ...payload, errorMessage: (error as Error).message, isConnected: client.isConnected });
  }
});

// GET /api/modbus/diagnostics - live view of every converter connection
// (doesn't reset the 30s health-log window).
app.get('/api/modbus/diagnostics', (_req, res) => {
  res.json({ now: new Date().toISOString(), endpoints: poller.diagnostics(false), push: pusher.status });
});

// Health snapshot of every converter every 30s - the first thing to read
// when a TR keeps going "not connected".
const HEALTH_LOG_INTERVAL_MS = 30_000;
setInterval(() => {
  for (const stats of poller.diagnostics(true)) {
    const w = stats.window;
    logger.info('health', stats.connected ? 'Endpoint OK' : 'Endpoint DOWN', {
      endpoint: stats.endpoint,
      connected: stats.connected,
      uptimeSec: stats.uptimeSec,
      usedBy: stats.usedBy.join(', '),
      bus: stats.bus ? `${stats.bus.name} (${stats.bus.waiting} waiting)` : undefined,
      last30s: `${w.ok}/${w.requests} ok, ${w.timeouts} timeouts, ${w.exceptions} exceptions, ${w.otherErrors} errors, ${w.drops} drops`,
      avgLatencyMs: w.ok ? Math.round(w.latencySumMs / w.ok) : undefined,
      maxLatencyMs: w.latencyMaxMs || undefined,
      queueDepth: stats.queueDepth,
      lastError: stats.lastError ? `${stats.lastError.message} @ ${stats.lastError.at}` : undefined,
    });
  }
}, HEALTH_LOG_INTERVAL_MS).unref();

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

// Polling and pushing only start once this copy owns the port - a second
// copy that fails to bind (below) must never touch the hardware.
const server = app.listen(PORT, GATEWAY_HOST, () => {
  logger.info('gateway', `Modbus gateway listening on http://${GATEWAY_HOST}:${PORT}`, {
    logLevel: process.env.LOG_LEVEL ?? 'info', logDir: logger.logDir, pid: process.pid,
  });
  poller.start();
  pusher.schedule(poller.currentConfig.readingsPushIntervalSeconds);
  void pusher.pushNow();
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

// Close device connections cleanly on Ctrl+C / service stop.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    poller.stop();
    pusher.stop();
    process.exit(0);
  });
}

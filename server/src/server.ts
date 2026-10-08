import express from 'express';
import type { Request } from 'express';
import cors from 'cors';
import { ModbusClient } from './ModbusClient';
import type { ModbusStatus } from './ModbusClient';

const PORT = Number(process.env.GATEWAY_PORT) || 4000;

const app = express();
app.use(cors());
app.use(express.json());

// Log every HTTP request/response through the gateway (separate from the
// Modbus-protocol-level logging inside ModbusClient, which logs the raw wire
// traffic to the device).
app.use((req, res, next) => {
  const startedAt = Date.now();
  const payload = Object.keys(req.body ?? {}).length > 0 ? req.body : req.query;
  console.log(`[HTTP] --> ${req.method} ${req.originalUrl} ${JSON.stringify(payload)}`);

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    const durationMs = Date.now() - startedAt;
    console.log(`[HTTP] <-- ${req.method} ${req.originalUrl} ${res.statusCode} (${durationMs}ms) ${JSON.stringify(body)}`);
    return originalJson(body);
  };

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
  if (endpointKeyByBinding.get(binding) !== key) releaseEndpoint(binding);

  let endpoint = endpoints.get(key);
  if (!endpoint) {
    endpoint = { key, client: new ModbusClient(nextEndpointId++), bindings: new Set() };
    endpoints.set(key, endpoint);
  }
  endpoint.bindings.add(binding);
  endpointKeyByBinding.set(binding, key);
  lastSeenByBinding.set(binding, Date.now());
  return endpoint.client;
}

// Unbinds a tab's gateway; the socket itself is only closed once nothing uses it.
function releaseEndpoint(binding: string): void {
  const key = endpointKeyByBinding.get(binding);
  if (!key) return;
  endpointKeyByBinding.delete(binding);
  lastSeenByBinding.delete(binding);
  const endpoint = endpoints.get(key);
  if (!endpoint) return;
  endpoint.bindings.delete(binding);
  if (endpoint.bindings.size === 0) {
    endpoint.client.disconnect();
    endpoints.delete(key);
  }
}

setInterval(() => {
  const cutoff = Date.now() - BINDING_IDLE_TIMEOUT_MS;
  for (const [binding, lastSeen] of lastSeenByBinding) {
    if (lastSeen < cutoff) {
      console.log(`[Gateway] Releasing idle binding ${binding}`);
      releaseEndpoint(binding);
    }
  }
}, 15_000).unref();

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
  const { clientId, ipAddress, port } = req.body as {
    clientId: number;
    ipAddress: string;
    port: number;
  };

  const client = acquireEndpoint(bindingFor(req, clientId), ipAddress, port);
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

app.listen(PORT, () => {
  console.log(`Modbus gateway listening on http://localhost:${PORT}`);
});

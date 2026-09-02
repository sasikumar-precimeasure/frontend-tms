import express from 'express';
import cors from 'cors';
import { ModbusClient } from './ModbusClient';
import type { ModbusStatus } from './ModbusClient';

const PORT = Number(process.env.GATEWAY_PORT) || 4000;

const app = express();
app.use(cors());
app.use(express.json());

const clients = new Map<number, ModbusClient>();

function getOrCreateClient(clientId: number): ModbusClient {
  let client = clients.get(clientId);
  if (!client) {
    client = new ModbusClient(clientId);
    clients.set(clientId, client);
  }
  return client;
}

function toConnectionPayload(client: ModbusClient, errorMessage: string | null) {
  const status: ModbusStatus = errorMessage ? 'error' : client.isConnected ? 'connected' : 'disconnected';
  return {
    clientId: client.clientId,
    ipAddress: client.ipAddress,
    port: client.port,
    status,
    isConnected: client.isConnected,
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

  const client = getOrCreateClient(clientId);
  let lastError: string | null = null;
  const offError = client.onErrorOccurred((event) => {
    lastError = event.errorMsg;
  });

  try {
    await client.connect(ipAddress, port);
    res.json(toConnectionPayload(client, null));
  } catch (ex) {
    const message = lastError ?? (ex instanceof Error ? ex.message : String(ex));
    res.status(502).json(toConnectionPayload(client, message));
  } finally {
    offError();
  }
});

// POST /api/modbus/disconnect  { clientId }
app.post('/api/modbus/disconnect', (req, res) => {
  const { clientId } = req.body as { clientId: number };
  const client = getOrCreateClient(clientId);
  client.disconnect();
  res.json(toConnectionPayload(client, null));
});

// GET /api/modbus/status/:clientId
app.get('/api/modbus/status/:clientId', (req, res) => {
  const clientId = Number(req.params.clientId);
  const client = getOrCreateClient(clientId);
  res.json(toConnectionPayload(client, null));
});

// GET /api/modbus/read/:clientId?slaveId=1&startAddress=4001&count=80
app.get('/api/modbus/read/:clientId', async (req, res) => {
  const clientId = Number(req.params.clientId);
  const slaveId = Number(req.query.slaveId ?? 1);
  const startAddress = Number(req.query.startAddress ?? 0);
  const count = Number(req.query.count ?? 1);

  const client = getOrCreateClient(clientId);
  let lastError: string | null = null;
  const offError = client.onErrorOccurred((event) => {
    lastError = event.errorMsg;
  });

  try {
    const registers = await client.readHoldingRegisters(slaveId, startAddress, count);
    res.json({ clientId, slaveId, startAddress, registers, errorMessage: null });
  } catch (ex) {
    const message = lastError ?? (ex instanceof Error ? ex.message : String(ex));
    res.status(502).json({ clientId, slaveId, startAddress, registers: null, errorMessage: message });
  } finally {
    offError();
  }
});

app.listen(PORT, () => {
  console.log(`Modbus gateway listening on http://localhost:${PORT}`);
});

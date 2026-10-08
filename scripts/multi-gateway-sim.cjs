#!/usr/bin/env node
// Simulates several independent Modbus TCP gateways (one per port) for
// testing multiple transformers locally. Every slave ID answers on every
// port; each gateway's values are offset slightly so TRs are distinguishable.
//
//   node scripts/multi-gateway-sim.cjs                 # ports 5511-5514
//   node scripts/multi-gateway-sim.cjs 5510 5511 5512  # custom ports
//
// Supports FC03 (read holding registers) and FC06 (write single register).
// IRTCC registers live at 40001+, 2243 registers at 0+ (the app's defaults).
const net = require('net');

const ports = process.argv.slice(2).map(Number).filter(Boolean);
if (ports.length === 0) ports.push(5511, 5512, 5513, 5514);

// Snapshot of the existing simulator's IRTCC (40001, 80 regs) and 2243 (0, 88 regs) maps.
const IRTCC_BASE = 40001;
const IRTCC_SEED = [0, 512, 0, 0, 0, 0, 0, 0, 0, 2, 820, 557, 0, 0, 0, 1, 16, 10, 8467, 0, 4083, 800, 850, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3];
const D2243_SEED = [597, 652, 0, 0, 5000, 500, 6000, 500, 7000, 500, 6000, 500, 0, 0, 0, 0, 0, 0, 0, 0, 6000, 500, 6000, 500];
D2243_SEED[87] = 10;

// Register indices that drift over time (temperatures/currents in the seed data).
const IRTCC_LIVE = [10, 11, 15, 18, 20];
const D2243_LIVE = [0, 1];

// registers[port][slaveId] = Map<address, value>
const banks = new Map();

function bankFor(port, slaveId) {
  if (!banks.has(port)) banks.set(port, new Map());
  const byPort = banks.get(port);
  if (!byPort.has(slaveId)) {
    const regs = new Map();
    const offset = ports.indexOf(port) * 15 + slaveId;
    IRTCC_SEED.forEach((v, i) => regs.set(IRTCC_BASE + i, v && IRTCC_LIVE.includes(i) ? v + offset : v));
    D2243_SEED.forEach((v, i) => regs.set(i, v === undefined ? 0 : D2243_LIVE.includes(i) ? v + offset : v));
    byPort.set(slaveId, regs);
  }
  return byPort.get(slaveId);
}

// Small random walk on the live registers so the dashboard visibly updates.
setInterval(() => {
  for (const byPort of banks.values()) {
    for (const regs of byPort.values()) {
      for (const i of IRTCC_LIVE) {
        const addr = IRTCC_BASE + i;
        const v = regs.get(addr) ?? 0;
        if (v > 0) regs.set(addr, Math.max(1, v + Math.round((Math.random() - 0.5) * 6)));
      }
      for (const i of D2243_LIVE) {
        const v = regs.get(i) ?? 0;
        if (v > 0) regs.set(i, Math.max(1, v + Math.round((Math.random() - 0.5) * 6)));
      }
    }
  }
}, 1000);

function exception(header, fc, code) {
  const resp = Buffer.alloc(9);
  header.copy(resp, 0, 0, 4); // transaction + protocol id
  resp.writeUInt16BE(3, 4);
  resp[6] = header[6];
  resp[7] = fc | 0x80;
  resp[8] = code;
  return resp;
}

function handle(port, frame) {
  const slaveId = frame[6];
  const fc = frame[7];
  const regs = bankFor(port, slaveId);

  if (fc === 0x03) {
    const start = frame.readUInt16BE(8);
    const qty = frame.readUInt16BE(10);
    if (qty < 1 || qty > 125) return exception(frame, fc, 3);
    const resp = Buffer.alloc(9 + qty * 2);
    frame.copy(resp, 0, 0, 4);
    resp.writeUInt16BE(3 + qty * 2, 4);
    resp[6] = slaveId;
    resp[7] = fc;
    resp[8] = qty * 2;
    for (let i = 0; i < qty; i++) resp.writeUInt16BE((regs.get(start + i) ?? 0) & 0xffff, 9 + i * 2);
    return resp;
  }

  if (fc === 0x06) {
    regs.set(frame.readUInt16BE(8), frame.readUInt16BE(10));
    console.log(`[:${port}] FC06 slave=${slaveId} addr=${frame.readUInt16BE(8)} value=${frame.readUInt16BE(10)}`);
    return Buffer.from(frame.subarray(0, 12)); // echo request
  }

  return exception(frame, fc, 1); // Illegal Function
}

for (const port of ports) {
  const server = net.createServer((socket) => {
    const peer = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[:${port}] client connected ${peer}`);
    let buffer = Buffer.alloc(0);

    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 7) {
        const frameLength = 6 + buffer.readUInt16BE(4);
        if (buffer.length < frameLength) break;
        const frame = buffer.subarray(0, frameLength);
        buffer = buffer.subarray(frameLength);
        // Simulate RS485 bus latency behind a real gateway.
        const resp = handle(port, frame);
        setTimeout(() => socket.writable && socket.write(resp), 20 + Math.random() * 60);
      }
    });
    socket.on('close', () => console.log(`[:${port}] client disconnected ${peer}`));
    socket.on('error', () => {});
  });
  server.listen(port, '127.0.0.1', () => console.log(`Modbus gateway simulator listening on 127.0.0.1:${port}`));
}

// TypeScript port of ModbusClient.vb for Node.js.
// net.Socket is Node's real TCP socket API - the direct equivalent of
// System.Net.Sockets.TcpClient used in the original VB class, so this
// class can open a genuine TCP connection to Modbus TCP hardware on port 502.
import { Socket } from 'net';
import { logger } from './logger';

export type ModbusStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface StatusChangedEvent {
  clientId: number;
  status: string;
  connected: boolean;
}

export interface ErrorOccurredEvent {
  clientId: number;
  errorMsg: string;
  slaveId: number;
}

type StatusChangedListener = (event: StatusChangedEvent) => void;
type ErrorOccurredListener = (event: ErrorOccurredEvent) => void;

// Constants mirror ModbusClient.vb
const CONNECT_TIMEOUT_MS = 3000;
// Longer than ModbusClient.vb's 1000ms: most of these slaves sit behind a
// TCP->RS485 gateway, where one request's round trip over the serial bus can
// legitimately take several hundred ms. A too-tight timeout here turned
// ordinary bus latency into "timed out" errors.
const READ_TIMEOUT_MS = 2000;
const WRITE_TIMEOUT_MS = 1000;
const MAX_REGISTERS = 125; // Modbus spec limit per transaction
// A single slow/offline slave must not drop the TCP connection that every
// other slave on the same gateway shares - only give up on the socket after
// this many timeouts in a row with no successful response in between (i.e.
// the gateway itself has gone quiet, not just one device behind it).
const MAX_CONSECUTIVE_TIMEOUTS = 3;
const KEEPALIVE_DELAY_MS = 10_000;
// Responses slower than this are logged as warnings (but still succeed).
const SLOW_RESPONSE_MS = 1000;

function toHex(buffer: Buffer): string {
  return buffer.toString('hex').match(/.{1,2}/g)?.join(' ') ?? '';
}

function getExceptionMessage(code: number): string {
  switch (code) {
    case 1:
      return 'Illegal Function';
    case 2:
      return 'Illegal Data Address';
    case 3:
      return 'Illegal Data Value';
    case 4:
      return 'Server Device Failure';
    case 5:
      return 'Acknowledge';
    case 6:
      return 'Server Device Busy';
    case 8:
      return 'Memory Parity Error';
    case 10:
      return 'Gateway Path Unavailable';
    case 11:
      return 'Gateway Target Device Failed';
    default:
      return `Unknown Exception 0x${code.toString(16).padStart(2, '0').toUpperCase()}`;
  }
}

// Pause between transactions on a shared RS485 bus, giving the converter
// that just finished time to release the line before the next one sends.
const BUS_TURNAROUND_MS = 20;

// An RS485 bus that more than one TCP converter is wired to. RS485 allows
// only one master at a time - if two converters on the same wires send at
// the same moment, the frames collide and both requests time out (and each
// converter may hand back the other one's traffic). Every ModbusClient
// attached to the same RS485Bus runs its transactions through here, so only
// one request is ever on the wires at a time, whichever converter it uses.
export class RS485Bus {
  private chain: Promise<unknown> = Promise.resolve();
  private _waiting = 0;

  constructor(readonly name: string) {}

  // Requests queued or running on this bus right now.
  get waiting(): number {
    return this._waiting;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    this._waiting += 1;
    const result = this.chain.then(task, task).finally(() => {
      this._waiting -= 1;
    });
    const pause = () => new Promise<void>((resolve) => setTimeout(resolve, BUS_TURNAROUND_MS));
    this.chain = result.then(pause, pause);
    return result;
  }
}

interface PendingTransaction {
  resolve: (frame: Buffer) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

// Counters for diagnosing connection problems on real hardware - logged as a
// periodic health snapshot by server.ts and served at /api/modbus/diagnostics.
export interface ConnectionCounters {
  requests: number;
  ok: number;
  timeouts: number;
  exceptions: number;
  otherErrors: number;
  lateResponses: number;
  connectAttempts: number;
  connectFailures: number;
  drops: number;
  latencySumMs: number;
  latencyMaxMs: number;
}

function emptyCounters(): ConnectionCounters {
  return {
    requests: 0, ok: 0, timeouts: 0, exceptions: 0, otherErrors: 0, lateResponses: 0,
    connectAttempts: 0, connectFailures: 0, drops: 0, latencySumMs: 0, latencyMaxMs: 0,
  };
}

function errorCode(err: Error): string | undefined {
  return (err as NodeJS.ErrnoException).code;
}

export class ModbusClient {
  // -- Fields (mirrors ModbusClient.vb private fields) --
  private readonly _clientId: number;
  private _socket: Socket | null = null;
  private _isConnected = false;
  private _ipAddress = '';
  private _port = 0;
  private _transactionId = 0;
  // In-flight connect attempt, so concurrent connect requests for the same
  // endpoint (auto-reconnect watcher + manual Connect + page reload) share
  // one attempt instead of each tearing down the socket the previous one
  // just opened.
  private _connectPromise: Promise<void> | null = null;
  // Responses are matched to requests by the MBAP transaction ID (see
  // attachFrameParser) rather than "next N bytes on the stream", so a late
  // response to a request that already timed out is simply discarded
  // instead of being mistaken for the next request's answer.
  private readonly _pending = new Map<number, PendingTransaction>();
  private _consecutiveTimeouts = 0;
  private _consecutiveBadFrames = 0;
  // Serializes every read/write against this socket. Two sub-devices on the
  // same TR (e.g. IRTCC + 2243) poll independently but share one
  // ModbusClient/TCP connection, and the RS485 bus behind the gateway can
  // only carry one transaction at a time anyway - chaining every request
  // through this promise keeps exactly one in flight per connection.
  private _requestQueue: Promise<unknown> = Promise.resolve();
  // Requests waiting in (or running from) _requestQueue - a steadily growing
  // number means polls arrive faster than the device answers.
  private _queueDepth = 0;
  private _connectedAt: number | null = null;
  private _bus: RS485Bus | null = null;
  private _lastError: { message: string; at: string } | null = null;
  private readonly _total = emptyCounters();
  private _window = emptyCounters();

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    this._queueDepth += 1;
    // Per-connection order first, then - if this converter shares its RS485
    // bus with others - wait for the bus to be free too.
    const tracked = () => (this._bus ? this._bus.run(task) : task()).finally(() => {
      this._queueDepth -= 1;
    });
    const result = this._requestQueue.then(tracked, tracked);
    // Swallow rejections in the chain itself (each caller still gets the
    // real rejection via `result`) so one failed request doesn't wedge the
    // queue for everything queued after it.
    this._requestQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private readonly _statusListeners = new Set<StatusChangedListener>();
  private readonly _errorListeners = new Set<ErrorOccurredListener>();

  constructor(clientId: number) {
    this._clientId = clientId;
  }

  // -- Properties (mirrors ModbusClient.vb ReadOnly Properties) --
  get clientId(): number {
    return this._clientId;
  }

  get isConnected(): boolean {
    return this._isConnected && this._socket !== null && !this._socket.destroyed;
  }

  get ipAddress(): string {
    return this._ipAddress;
  }

  get port(): number {
    return this._port;
  }

  get endpoint(): string {
    return `${this._ipAddress}:${this._port}`;
  }

  get bus(): RS485Bus | null {
    return this._bus;
  }

  setBus(bus: RS485Bus | null): void {
    if (bus === this._bus) return;
    logger.info('modbus', bus ? 'Joined shared RS485 bus' : 'Left shared RS485 bus', {
      conn: this._clientId, endpoint: this.endpoint, bus: (bus ?? this._bus)?.name,
    });
    this._bus = bus;
  }

  // A reply must come from the slave that was asked, for the function that
  // was asked. A converter sharing its RS485 bus with another master can
  // pass on the other master's traffic - seen in the field as "slave 44"
  // arriving in reply to a request for slave 33. Unit IDs 0 and 255 are
  // accepted since some devices answer with those regardless.
  private checkReplySource(frame: Buffer, slaveId: number, fc: number, label: string): void {
    const replyUnit = frame[6];
    const replyFc = frame[7] & 0x7f;
    if ((replyUnit === slaveId || replyUnit === 0 || replyUnit === 255) && replyFc === fc) return;
    const message = `${label}: Reply came from slave ${replyUnit} (function ${replyFc}) instead of slave ${slaveId} - is another master on the RS485 bus?`;
    this.count('otherErrors');
    this.noteError(message);
    logger.warn('modbus', 'Reply from the wrong slave/function - discarded', {
      conn: this._clientId, endpoint: this.endpoint, askedSlave: slaveId, askedFc: fc, replySlave: replyUnit, replyFc,
      bus: this._bus?.name, bytes: toHex(frame.subarray(0, 32)),
    });
    throw new Error(message);
  }

  private count(key: keyof ConnectionCounters, amount = 1): void {
    this._total[key] += amount;
    this._window[key] += amount;
  }

  private recordLatency(ms: number): void {
    this.count('latencySumMs', ms);
    this._total.latencyMaxMs = Math.max(this._total.latencyMaxMs, ms);
    this._window.latencyMaxMs = Math.max(this._window.latencyMaxMs, ms);
  }

  private noteError(message: string): void {
    this._lastError = { message, at: new Date().toISOString() };
  }

  // Current state plus counters since the previous reset (`window`) and
  // since start (`total`). resetWindow=false peeks without resetting.
  takeStats(resetWindow = true) {
    const window = this._window;
    if (resetWindow) this._window = emptyCounters();
    return {
      endpoint: this.endpoint,
      connected: this.isConnected,
      connecting: this._connectPromise !== null,
      uptimeSec: this._connectedAt ? Math.round((Date.now() - this._connectedAt) / 1000) : 0,
      queueDepth: this._queueDepth,
      inFlight: this._pending.size,
      bus: this._bus ? { name: this._bus.name, waiting: this._bus.waiting } : null,
      consecutiveTimeouts: this._consecutiveTimeouts,
      lastError: this._lastError,
      window,
      total: { ...this._total },
    };
  }

  // -- Events (mirrors RaiseEvent StatusChanged / ErrorOccurred) --
  onStatusChanged(listener: StatusChangedListener): () => void {
    this._statusListeners.add(listener);
    return () => this._statusListeners.delete(listener);
  }

  onErrorOccurred(listener: ErrorOccurredListener): () => void {
    this._errorListeners.add(listener);
    return () => this._errorListeners.delete(listener);
  }

  private raiseStatusChanged(status: string, connected: boolean): void {
    const event: StatusChangedEvent = { clientId: this._clientId, status, connected };
    this._statusListeners.forEach((listener) => listener(event));
  }

  private raiseErrorOccurred(errorMsg: string, slaveId = 255): void {
    const event: ErrorOccurredEvent = { clientId: this._clientId, errorMsg, slaveId };
    this._errorListeners.forEach((listener) => listener(event));
  }

  // -- Connection --
  // Mirrors: Public Sub Connect(ipAddress As String, port As Integer)
  // Idempotent: connecting to the endpoint this client is already connected
  // (or connecting) to reuses that socket instead of replacing it. Replacing
  // a healthy socket on every redundant connect was what made one TR's
  // reconnect knock the readings for it offline again.
  connect(ipAddress: string, port: number): Promise<void> {
    const sameEndpoint = this._ipAddress === ipAddress && this._port === port;
    if (sameEndpoint && this.isConnected) {
      logger.debug('modbus', 'Connect: already connected, reusing socket', { conn: this._clientId, endpoint: this.endpoint });
      return Promise.resolve();
    }
    if (sameEndpoint && this._connectPromise) {
      return this._connectPromise;
    }

    if (this._socket) {
      this.disconnect();
    }

    this._ipAddress = ipAddress;
    this._port = port;
    const attempt = this.openSocket(ipAddress, port);
    this._connectPromise = attempt;
    const clear = () => {
      if (this._connectPromise === attempt) this._connectPromise = null;
    };
    attempt.then(clear, clear);
    return attempt;
  }

  private openSocket(ipAddress: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      this.count('connectAttempts');
      logger.info('modbus', 'Connecting', { conn: this._clientId, endpoint: `${ipAddress}:${port}`, attempt: this._total.connectAttempts });
      this.raiseStatusChanged(`Connecting to ${ipAddress}:${port}...`, false);

      const socket = new Socket();
      this._socket = socket;
      socket.setNoDelay(true);
      socket.setTimeout(CONNECT_TIMEOUT_MS);

      // Every handler below checks it still belongs to the *current* socket -
      // a replaced socket's late 'close'/'error' must never clobber the state
      // of the connection that replaced it.
      const isCurrent = () => this._socket === socket;
      let settled = false;

      const fail = (message: string, err: Error) => {
        if (settled) return;
        settled = true;
        this.count('connectFailures');
        this.noteError(`Connect: ${message}`);
        logger.warn('modbus', 'Connect failed', {
          conn: this._clientId, endpoint: `${ipAddress}:${port}`, error: message, code: errorCode(err),
          elapsedMs: Date.now() - startedAt, failuresTotal: this._total.connectFailures,
        });
        socket.destroy();
        if (isCurrent()) {
          this._socket = null;
          this._isConnected = false;
          this.raiseStatusChanged('Disconnected', false);
          this.raiseErrorOccurred(`Connect: ${message}`);
        }
        reject(err);
      };

      socket.once('connect', () => {
        if (settled) return;
        settled = true;
        socket.setTimeout(0); // disable connect timeout; transactions set their own
        socket.setKeepAlive(true, KEEPALIVE_DELAY_MS);
        if (!isCurrent()) {
          socket.destroy();
          reject(new Error('Connect: superseded by a newer connection'));
          return;
        }
        this._isConnected = true;
        this._consecutiveTimeouts = 0;
        this._consecutiveBadFrames = 0;
        this._connectedAt = Date.now();
        this.attachFrameParser(socket);
        logger.info('modbus', 'Connected', {
          conn: this._clientId, endpoint: `${ipAddress}:${port}`, elapsedMs: Date.now() - startedAt, localPort: socket.localPort,
        });
        this.raiseStatusChanged(`Connected to ${ipAddress}:${port}`, true);
        resolve();
      });

      socket.on('timeout', () => {
        const message = `Connection to ${ipAddress}:${port} timed out`;
        fail(message, new Error(message));
      });

      socket.on('error', (err: Error) => {
        if (!settled) {
          fail(err.message, err);
          return;
        }
        // Error after a successful connect: mirror VB's comm-error handling.
        if (!isCurrent()) return;
        logger.warn('modbus', 'Socket error on open connection', { conn: this._clientId, endpoint: this.endpoint, error: err.message, code: errorCode(err) });
        this.dropConnection(`Comm error: ${err.message}`);
      });

      socket.once('close', (hadError: boolean) => {
        if (!settled) {
          fail('Connection closed', new Error('Connection closed'));
          return;
        }
        if (!isCurrent()) return;
        // The device/gateway ended the TCP session itself - typical causes:
        // it only allows N simultaneous connections, an idle timeout, or the
        // device restarted.
        logger.warn('modbus', 'Remote host closed the connection', { conn: this._clientId, endpoint: this.endpoint, hadError });
        this.dropConnection('Connection closed by remote host');
      });

      socket.connect(port, ipAddress);
    });
  }

  // Splits the incoming byte stream into Modbus TCP frames using the MBAP
  // header's length field (bytes 4-5 = number of bytes that follow), then
  // hands each frame to whichever pending transaction owns its ID.
  private attachFrameParser(socket: Socket): void {
    let buffer = Buffer.alloc(0);
    socket.on('data', (data: Buffer) => {
      if (this._socket !== socket) return;
      buffer = Buffer.concat([buffer, data]);

      while (buffer.length >= 7) {
        const protocolId = buffer.readUInt16BE(2);
        const length = buffer.readUInt16BE(4);
        if (protocolId !== 0 || length < 2 || length > 254) {
          // Not a valid Modbus TCP reply. The connection itself is fine and
          // only one request is ever in flight (see _requestQueue), so
          // discarding everything received so far and failing that request
          // resynchronizes the stream. Never reconnects for this, however
          // often it happens - the TR stays "connected" and the device shows
          // the error instead; the count is only for the log.
          this._consecutiveBadFrames += 1;
          const message = 'Invalid response from device (corrupted data)';
          this.count('otherErrors');
          this.noteError(message);
          logger.warn('modbus', 'Invalid response from device - discarded, connection kept', {
            conn: this._clientId, endpoint: this.endpoint, bytes: toHex(buffer.subarray(0, 32)),
            consecutive: this._consecutiveBadFrames,
          });
          buffer = Buffer.alloc(0);
          const failed = [...this._pending.values()];
          this._pending.clear();
          failed.forEach((p) => {
            clearTimeout(p.timer);
            p.reject(new Error(message));
          });
          return;
        }
        this._consecutiveBadFrames = 0;
        const frameLength = 6 + length;
        if (buffer.length < frameLength) break;

        const frame = Buffer.from(buffer.subarray(0, frameLength));
        buffer = buffer.subarray(frameLength);
        const tid = frame.readUInt16BE(0);
        const pending = this._pending.get(tid);
        if (!pending) {
          this.count('lateResponses');
          logger.warn('modbus', 'Late/unknown response discarded (arrived after its request timed out)', {
            conn: this._clientId, endpoint: this.endpoint, tid, slave: frame[6], fc: frame[7],
          });
          continue;
        }
        this._pending.delete(tid);
        clearTimeout(pending.timer);
        pending.resolve(frame);
      }
    });
  }

  // The socket died underneath us (remote close, comm error, unrecoverable
  // framing) - as opposed to disconnect(), which the user asked for.
  private dropConnection(reason: string): void {
    this.count('drops');
    this.noteError(reason);
    logger.warn('modbus', 'Connection dropped', {
      conn: this._clientId, endpoint: this.endpoint, reason,
      uptimeSec: this._connectedAt ? Math.round((Date.now() - this._connectedAt) / 1000) : 0,
      inFlight: this._pending.size, queueDepth: this._queueDepth, dropsTotal: this._total.drops,
    });
    this.teardown(new Error(reason));
    this.raiseStatusChanged('Disconnected', false);
    this.raiseErrorOccurred(reason);
  }

  private teardown(reason: Error): void {
    this._isConnected = false;
    this._connectedAt = null;
    const socket = this._socket;
    this._socket = null;
    try {
      socket?.destroy();
    } catch {
      // ignore, mirrors VB's empty Catch in Disconnect()
    }
    const pending = [...this._pending.values()];
    this._pending.clear();
    pending.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(reason);
    });
  }

  // Mirrors: Public Sub Disconnect()
  disconnect(): void {
    logger.info('modbus', 'Disconnect requested', { conn: this._clientId, endpoint: this.endpoint });
    this._connectPromise = null;
    this.teardown(new Error('Disconnected'));
    this.raiseStatusChanged('Disconnected', false);
  }

  // Sends one request frame and waits for the response frame carrying the
  // same transaction ID. A timeout fails just this request; the connection
  // is only dropped after MAX_CONSECUTIVE_TIMEOUTS in a row.
  private transact(tid: number, request: Buffer, timeoutMs: number, label: string, slaveId: number): Promise<Buffer> {
    const socket = this._socket;
    this.count('requests');
    if (!this.isConnected || !socket) {
      this.count('otherErrors');
      this.raiseErrorOccurred(`${label}: Not connected`, slaveId);
      return Promise.reject(new Error(`${label}: Not connected`));
    }

    const fc = request[7];
    const sentAt = Date.now();
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(tid);
        this._consecutiveTimeouts += 1;
        this.count('timeouts');
        const message = `${label}: Response timeout (slave ${slaveId})`;
        this.noteError(message);
        logger.warn('modbus', 'Response timeout', {
          conn: this._clientId, endpoint: this.endpoint, slave: slaveId, fc, tid, timeoutMs,
          consecutive: `${this._consecutiveTimeouts}/${MAX_CONSECUTIVE_TIMEOUTS}`, queueDepth: this._queueDepth,
        });
        if (this._consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
          this.dropConnection('Comm error: gateway stopped responding');
        }
        this.raiseErrorOccurred(message, slaveId);
        reject(new Error(message));
      }, timeoutMs);

      this._pending.set(tid, {
        resolve: (frame) => {
          this._consecutiveTimeouts = 0;
          const latencyMs = Date.now() - sentAt;
          this.recordLatency(latencyMs);
          if (latencyMs > SLOW_RESPONSE_MS) {
            logger.warn('modbus', 'Slow response', { conn: this._clientId, endpoint: this.endpoint, slave: slaveId, fc, latencyMs });
          }
          resolve(frame);
        },
        reject,
        timer,
      });

      socket.write(request, (err) => {
        if (!err) return;
        const pending = this._pending.get(tid);
        if (!pending) return;
        this._pending.delete(tid);
        clearTimeout(pending.timer);
        this.count('otherErrors');
        this.noteError(`${label}: ${err.message}`);
        logger.warn('modbus', 'Socket write failed', { conn: this._clientId, endpoint: this.endpoint, slave: slaveId, error: err.message, code: errorCode(err) });
        this.raiseErrorOccurred(`${label}: ${err.message}`, slaveId);
        reject(err);
      });
    });
  }

  // -- FC03: Read Holding Registers --
  // Mirrors: Public Sub ReadRegisters(slaveId As Byte, startAddress As Integer, count As Integer)
  // Max 125 registers per request; splits automatically for larger counts.
  async readHoldingRegisters(slaveId: number, startAddress: number, count: number): Promise<number[]> {
    if (count <= 0) return [];
    if (count > MAX_REGISTERS * 100) count = MAX_REGISTERS * 100; // sane upper bound, VB caps a single call at 125

    if (!this.isConnected) {
      this.raiseErrorOccurred('Read: Not connected', slaveId);
      throw new Error('Read: Not connected');
    }

    const allRegisters: number[] = [];
    let remaining = count;
    let currentAddress = startAddress;

    while (remaining > 0) {
      const chunk = Math.min(remaining, MAX_REGISTERS);
      const regs = await this.readRegistersChunk(slaveId, currentAddress, chunk);
      allRegisters.push(...regs);
      currentAddress += chunk;
      remaining -= chunk;
    }

    return allRegisters;
  }

  private nextTransactionId(): number {
    if (this._transactionId >= 65534) this._transactionId = 0;
    this._transactionId += 1;
    if (this._transactionId === 0) this._transactionId = 1;
    return this._transactionId;
  }

  private readRegistersChunk(slaveId: number, startAddress: number, count: number): Promise<number[]> {
    return this.enqueue(() => this.readRegistersChunkImpl(slaveId, startAddress, count));
  }

  private async readRegistersChunkImpl(slaveId: number, startAddress: number, count: number): Promise<number[]> {
    const tid = this.nextTransactionId();

    // Build Modbus TCP ADU (7-byte MBAP header + PDU)
    // MBAP: Transaction ID (2), Protocol ID (2=0), Length (2), Unit ID (1)
    // PDU: FC (1), Start Addr Hi (1), Start Addr Lo (1), Qty Hi (1), Qty Lo (1)
    const request = Buffer.alloc(12);
    request.writeUInt16BE(tid, 0); // Transaction ID
    request.writeUInt16BE(0, 2); // Protocol ID (always 0)
    request.writeUInt16BE(6, 4); // Length (6 bytes follow)
    request.writeUInt8(slaveId, 6); // Unit ID
    request.writeUInt8(0x03, 7); // Function Code 03
    request.writeUInt16BE(startAddress, 8); // Start Address
    request.writeUInt16BE(count, 10); // Quantity

    if (logger.isDebug()) {
      logger.debug('modbus', 'FC03 request', { conn: this._clientId, tid, slave: slaveId, start: startAddress, qty: count, bytes: toHex(request) });
    }

    const frame = await this.transact(tid, request, READ_TIMEOUT_MS, 'Read', slaveId);
    this.checkReplySource(frame, slaveId, 0x03, 'Read');

    // Check for exception response
    if ((frame[7] & 0x80) === 0x80) {
      const message = `FC03 Exception: ${getExceptionMessage(frame[8])}`;
      this.count('exceptions');
      this.noteError(message);
      logger.warn('modbus', 'Device returned Modbus exception', { conn: this._clientId, endpoint: this.endpoint, slave: slaveId, start: startAddress, qty: count, exception: message });
      this.raiseErrorOccurred(message, slaveId);
      throw new Error(message);
    }

    // Guard against a slave returning a byteCount that doesn't match what we
    // asked for (malformed/non-conformant response) - trusting the requested
    // `count` here (as ModbusClient.vb does) would silently produce
    // corrupted/undefined register values. The frame was already delimited
    // by its MBAP length, so the stream itself is still in sync - only this
    // request fails, the connection stays up.
    const byteCount = frame[8];
    const dataBytes = frame.subarray(9);
    if (byteCount !== count * 2 || dataBytes.length !== byteCount) {
      const message = `Read: Unexpected byte count ${byteCount} for ${count} register(s)`;
      this.count('otherErrors');
      this.noteError(message);
      logger.warn('modbus', 'Malformed FC03 response', { conn: this._clientId, endpoint: this.endpoint, slave: slaveId, error: message, bytes: toHex(frame.subarray(0, 32)) });
      this.raiseErrorOccurred(message, slaveId);
      throw new Error(message);
    }

    const registers: number[] = [];
    for (let i = 0; i < count; i++) {
      registers.push(dataBytes.readUInt16BE(i * 2));
    }

    this.count('ok');
    if (logger.isDebug()) {
      logger.debug('modbus', 'FC03 response', { conn: this._clientId, tid, slave: slaveId, registers: registers.join(',') });
    }

    return registers;
  }

  // -- FC06: Write Single Register --
  // Mirrors: Public Sub WriteSingleRegister(slaveId As Byte, address As Integer, value As UShort)
  writeSingleRegister(slaveId: number, address: number, value: number): Promise<void> {
    return this.enqueue(() => this.writeSingleRegisterImpl(slaveId, address, value));
  }

  private async writeSingleRegisterImpl(slaveId: number, address: number, value: number): Promise<void> {
    const tid = this.nextTransactionId();

    // MBAP(6) + Unit(1) + FC(1) + Address(2) + Value(2) = 12 bytes
    const request = Buffer.alloc(12);
    request.writeUInt16BE(tid, 0);
    request.writeUInt16BE(0, 2);
    request.writeUInt16BE(6, 4);
    request.writeUInt8(slaveId, 6);
    request.writeUInt8(0x06, 7); // Function Code 06
    request.writeUInt16BE(address, 8);
    request.writeUInt16BE(value, 10);

    logger.info('modbus', 'FC06 write', { conn: this._clientId, endpoint: this.endpoint, tid, slave: slaveId, address, value });

    const frame = await this.transact(tid, request, WRITE_TIMEOUT_MS, 'Write', slaveId);
    this.checkReplySource(frame, slaveId, 0x06, 'Write');

    if ((frame[7] & 0x80) === 0x80) {
      const message = `Write FC06 Exception: ${getExceptionMessage(frame[8])}`;
      this.count('exceptions');
      this.noteError(message);
      logger.warn('modbus', 'Device rejected write', { conn: this._clientId, endpoint: this.endpoint, slave: slaveId, address, exception: message });
      this.raiseErrorOccurred(message, slaveId);
      throw new Error(message);
    }

    if (frame.length < 12) {
      this.count('otherErrors');
      logger.warn('modbus', 'Incomplete FC06 response', { conn: this._clientId, endpoint: this.endpoint, slave: slaveId, bytes: toHex(frame) });
      this.raiseErrorOccurred('WriteSingle: Incomplete response', slaveId);
      throw new Error('WriteSingle: Incomplete response');
    }

    this.count('ok');
    logger.info('modbus', 'FC06 write confirmed', { conn: this._clientId, endpoint: this.endpoint, tid, slave: slaveId, address, value });
  }

  static get readTimeoutMs(): number {
    return READ_TIMEOUT_MS;
  }

  static get writeTimeoutMs(): number {
    return WRITE_TIMEOUT_MS;
  }
}

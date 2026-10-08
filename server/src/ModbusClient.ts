// TypeScript port of ModbusClient.vb for Node.js.
// net.Socket is Node's real TCP socket API - the direct equivalent of
// System.Net.Sockets.TcpClient used in the original VB class, so this
// class can open a genuine TCP connection to Modbus TCP hardware on port 502.
import { Socket } from 'net';

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

interface PendingTransaction {
  resolve: (frame: Buffer) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
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
  // Serializes every read/write against this socket. Two sub-devices on the
  // same TR (e.g. IRTCC + 2243) poll independently but share one
  // ModbusClient/TCP connection, and the RS485 bus behind the gateway can
  // only carry one transaction at a time anyway - chaining every request
  // through this promise keeps exactly one in flight per connection.
  private _requestQueue: Promise<unknown> = Promise.resolve();

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this._requestQueue.then(task, task);
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
      console.log(`[Modbus:${this._clientId}] Connect request  -> ${ipAddress}:${port} (already connected, reusing)`);
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
      console.log(`[Modbus:${this._clientId}] Connect request  -> ${ipAddress}:${port}`);
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
        console.log(`[Modbus:${this._clientId}] Connect response <- ${message}`);
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
        this.attachFrameParser(socket);
        console.log(`[Modbus:${this._clientId}] Connect response <- connected to ${ipAddress}:${port}`);
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
        console.log(`[Modbus:${this._clientId}] Comm error <- ${err.message}`);
        this.dropConnection(`Comm error: ${err.message}`);
      });

      socket.once('close', () => {
        if (!settled) {
          fail('Connection closed', new Error('Connection closed'));
          return;
        }
        if (!isCurrent()) return;
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
          // Not a valid MBAP header - framing is genuinely lost, the only
          // recovery is a fresh socket.
          console.log(`[Modbus:${this._clientId}] Invalid MBAP header, dropping connection [${toHex(buffer)}]`);
          this.dropConnection('Comm error: invalid response framing');
          return;
        }
        const frameLength = 6 + length;
        if (buffer.length < frameLength) break;

        const frame = Buffer.from(buffer.subarray(0, frameLength));
        buffer = buffer.subarray(frameLength);
        const tid = frame.readUInt16BE(0);
        const pending = this._pending.get(tid);
        if (!pending) {
          console.log(`[Modbus:${this._clientId}] Discarding late/unknown response tid=${tid} [${toHex(frame)}]`);
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
    this.teardown(new Error(reason));
    this.raiseStatusChanged('Disconnected', false);
    this.raiseErrorOccurred(reason);
  }

  private teardown(reason: Error): void {
    this._isConnected = false;
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
    console.log(`[Modbus:${this._clientId}] Disconnect request -> ${this._ipAddress}:${this._port}`);
    this._connectPromise = null;
    this.teardown(new Error('Disconnected'));
    this.raiseStatusChanged('Disconnected', false);
  }

  // Sends one request frame and waits for the response frame carrying the
  // same transaction ID. A timeout fails just this request; the connection
  // is only dropped after MAX_CONSECUTIVE_TIMEOUTS in a row.
  private transact(tid: number, request: Buffer, timeoutMs: number, label: string, slaveId: number): Promise<Buffer> {
    const socket = this._socket;
    if (!this.isConnected || !socket) {
      this.raiseErrorOccurred(`${label}: Not connected`, slaveId);
      return Promise.reject(new Error(`${label}: Not connected`));
    }

    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(tid);
        this._consecutiveTimeouts += 1;
        const message = `${label}: Response timeout (slave ${slaveId})`;
        console.log(
          `[Modbus:${this._clientId}] tid=${tid} - ${message} (${this._consecutiveTimeouts}/${MAX_CONSECUTIVE_TIMEOUTS} consecutive)`
        );
        if (this._consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
          this.dropConnection('Comm error: gateway stopped responding');
        }
        this.raiseErrorOccurred(message, slaveId);
        reject(new Error(message));
      }, timeoutMs);

      this._pending.set(tid, {
        resolve: (frame) => {
          this._consecutiveTimeouts = 0;
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

    console.log(
      `[Modbus:${this._clientId}] FC03 request  tid=${tid} slave=${slaveId} start=${startAddress} qty=${count} bytes=[${toHex(request)}]`
    );

    const frame = await this.transact(tid, request, READ_TIMEOUT_MS, 'Read', slaveId);

    // Check for exception response
    if ((frame[7] & 0x80) === 0x80) {
      const message = `FC03 Exception: ${getExceptionMessage(frame[8])}`;
      console.log(`[Modbus:${this._clientId}] FC03 response tid=${tid} - ${message} [${toHex(frame)}]`);
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
      console.log(`[Modbus:${this._clientId}] FC03 response tid=${tid} - ${message} [${toHex(frame)}]`);
      this.raiseErrorOccurred(message, slaveId);
      throw new Error(message);
    }

    const registers: number[] = [];
    for (let i = 0; i < count; i++) {
      registers.push(dataBytes.readUInt16BE(i * 2));
    }

    console.log(
      `[Modbus:${this._clientId}] FC03 response tid=${tid} slave=${slaveId} bytes=[${toHex(frame)}] registers=[${registers.join(', ')}]`
    );

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

    console.log(
      `[Modbus:${this._clientId}] FC06 request  tid=${tid} slave=${slaveId} address=${address} value=${value} bytes=[${toHex(request)}]`
    );

    const frame = await this.transact(tid, request, WRITE_TIMEOUT_MS, 'Write', slaveId);

    if ((frame[7] & 0x80) === 0x80) {
      const message = `Write FC06 Exception: ${getExceptionMessage(frame[8])}`;
      console.log(`[Modbus:${this._clientId}] FC06 response tid=${tid} - ${message} [${toHex(frame)}]`);
      this.raiseErrorOccurred(message, slaveId);
      throw new Error(message);
    }

    if (frame.length < 12) {
      console.log(`[Modbus:${this._clientId}] FC06 response tid=${tid} - incomplete response [${toHex(frame)}]`);
      this.raiseErrorOccurred('WriteSingle: Incomplete response', slaveId);
      throw new Error('WriteSingle: Incomplete response');
    }

    console.log(`[Modbus:${this._clientId}] FC06 response tid=${tid} - confirmed [${toHex(frame)}]`);
  }

  static get readTimeoutMs(): number {
    return READ_TIMEOUT_MS;
  }

  static get writeTimeoutMs(): number {
    return WRITE_TIMEOUT_MS;
  }
}

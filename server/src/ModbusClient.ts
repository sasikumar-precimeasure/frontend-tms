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
const READ_TIMEOUT_MS = 1000;
const WRITE_TIMEOUT_MS = 1000;
const MAX_REGISTERS = 125; // Modbus spec limit per transaction

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

export class ModbusClient {
  // -- Fields (mirrors ModbusClient.vb private fields) --
  private readonly _clientId: number;
  private _socket: Socket | null = null;
  private _isConnected = false;
  private _ipAddress = '';
  private _port = 0;
  private _transactionId = 0;
  // Persistent receive buffer for the current socket - all incoming bytes land
  // here (via a single 'data' listener attached in connect()) so readBytes can
  // pull exactly the amount it needs regardless of how TCP packets are chunked.
  private _recvBuffer: Buffer = Buffer.alloc(0);
  private _recvWaiters: Array<() => void> = [];

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
  connect(ipAddress: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this._isConnected) {
        this.disconnect();
      }

      this._ipAddress = ipAddress;
      this._port = port;
      this.raiseStatusChanged(`Connecting to ${ipAddress}:${port}...`, false);

      const socket = new Socket();
      this._socket = socket;
      socket.setNoDelay(true);
      socket.setTimeout(CONNECT_TIMEOUT_MS);

      let settled = false;

      const cleanupListeners = () => {
        socket.removeAllListeners('connect');
        socket.removeAllListeners('timeout');
        socket.removeAllListeners('error');
      };

      socket.once('connect', () => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        socket.setTimeout(0); // disable connect timeout; reads/writes set their own below
        this._isConnected = true;
        this._recvBuffer = Buffer.alloc(0);
        socket.on('data', (data: Buffer) => {
          this._recvBuffer = Buffer.concat([this._recvBuffer, data]);
          const waiters = this._recvWaiters;
          this._recvWaiters = [];
          waiters.forEach((wake) => wake());
        });
        this.raiseStatusChanged(`Connected to ${ipAddress}:${port}`, true);
        resolve();
      });

      socket.once('timeout', () => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        const message = `Connection to ${ipAddress}:${port} timed out`;
        socket.destroy();
        this._socket = null;
        this._isConnected = false;
        this.raiseStatusChanged('Disconnected', false);
        this.raiseErrorOccurred(`Connect: ${message}`);
        reject(new Error(message));
      });

      socket.once('error', (err: Error) => {
        this._isConnected = false;
        if (settled) {
          // Error after a successful connect: mirror VB's comm-error handling.
          this._socket = null;
          this.raiseStatusChanged('Disconnected', false);
          this.raiseErrorOccurred(`Comm error: ${err.message}`);
          return;
        }
        settled = true;
        cleanupListeners();
        this._socket = null;
        this.raiseStatusChanged('Disconnected', false);
        this.raiseErrorOccurred(`Connect: ${err.message}`);
        reject(err);
      });

      socket.once('close', () => {
        if (!this._isConnected) return;
        this._isConnected = false;
        this._socket = null;
        this.raiseStatusChanged('Disconnected', false);
      });

      socket.connect(port, ipAddress);
    });
  }

  // Mirrors: Public Sub Disconnect()
  disconnect(): void {
    this._isConnected = false;
    try {
      this._socket?.destroy();
    } catch {
      // ignore, mirrors VB's empty Catch in Disconnect()
    }
    this._socket = null;
    this._recvBuffer = Buffer.alloc(0);
    const waiters = this._recvWaiters;
    this._recvWaiters = [];
    waiters.forEach((wake) => wake());
    this.raiseStatusChanged('Disconnected', false);
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

  private async readRegistersChunk(slaveId: number, startAddress: number, count: number): Promise<number[]> {
    const socket = this._socket;
    if (!socket) {
      this.raiseErrorOccurred('Read: Not connected', slaveId);
      throw new Error('Read: Not connected');
    }

    const tid = this.nextTransactionId();

    // Build Modbus TCP ADU (7-byte MBAP header + PDU)
    // MBAP: Transaction ID (2), Protocol ID (2=0), Length (2), Unit ID (1)
    // PDU: FC (1), Start Addr Hi (1), Start Addr Lo (1), Qty Hi (1), Qty Lo (1)
    const request = Buffer.alloc(12);
    request.writeUInt8((tid >> 8) & 0xff, 0); // Transaction ID High
    request.writeUInt8(tid & 0xff, 1); // Transaction ID Low
    request.writeUInt8(0, 2); // Protocol ID High (always 0)
    request.writeUInt8(0, 3); // Protocol ID Low (always 0)
    request.writeUInt8(0, 4); // Length High
    request.writeUInt8(6, 5); // Length Low (6 bytes follow)
    request.writeUInt8(slaveId, 6); // Unit ID
    request.writeUInt8(0x03, 7); // Function Code 03
    request.writeUInt8((startAddress >> 8) & 0xff, 8); // Start Address High
    request.writeUInt8(startAddress & 0xff, 9); // Start Address Low
    request.writeUInt8((count >> 8) & 0xff, 10); // Quantity High
    request.writeUInt8(count & 0xff, 11); // Quantity Low

    await this.writeToSocket(socket, request);

    // Read response header (9 bytes: 6 MBAP + FC + byte count)
    const header = await this.readBytes(socket, 9, READ_TIMEOUT_MS);
    if (header.length !== 9) {
      this.raiseErrorOccurred('Read: Incomplete response header', slaveId);
      throw new Error('Read: Incomplete response header');
    }

    // Check for exception response
    if ((header[7] & 0x80) === 0x80) {
      const message = `FC03 Exception: ${getExceptionMessage(header[8])}`;
      this.raiseErrorOccurred(message, slaveId);
      throw new Error(message);
    }

    const byteCount = header[8];
    const dataBytes = await this.readBytes(socket, byteCount, READ_TIMEOUT_MS);
    if (dataBytes.length !== byteCount) {
      this.raiseErrorOccurred('Read: Incomplete data response', slaveId);
      throw new Error('Read: Incomplete data response');
    }

    const registers: number[] = [];
    for (let i = 0; i < count; i++) {
      registers.push((dataBytes[i * 2] << 8) | dataBytes[i * 2 + 1]);
    }
    return registers;
  }

  private writeToSocket(socket: Socket, data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Write timed out')), WRITE_TIMEOUT_MS);
      socket.write(data, (err) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Mirrors ModbusClient.vb's ReadBytes: accumulates until `count` bytes arrive or times out.
  // Pulls from the persistent per-socket receive buffer (fed by the single 'data'
  // listener attached in connect()) so bytes from one TCP packet that satisfy more
  // than the current request (e.g. header + data arriving together) aren't dropped.
  private readBytes(socket: Socket, count: number, timeoutMs: number): Promise<Buffer> {
    if (count === 0) return Promise.resolve(Buffer.alloc(0));

    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;

      const tryConsume = (): boolean => {
        if (this._recvBuffer.length >= count) {
          const result = this._recvBuffer.subarray(0, count);
          this._recvBuffer = this._recvBuffer.subarray(count);
          resolve(Buffer.from(result));
          return true;
        }
        return false;
      };

      if (tryConsume()) return;

      const wake = () => {
        if (tryConsume()) {
          clearTimeout(timer);
          return;
        }
        if (socket.destroyed) {
          clearTimeout(timer);
          resolve(Buffer.from(this._recvBuffer));
          this._recvBuffer = Buffer.alloc(0);
          return;
        }
        this._recvWaiters.push(wake);
      };

      const timer = setTimeout(() => {
        this._recvWaiters = this._recvWaiters.filter((w) => w !== wake);
        const available = Math.min(count, this._recvBuffer.length);
        const result = this._recvBuffer.subarray(0, available);
        this._recvBuffer = this._recvBuffer.subarray(available);
        resolve(Buffer.from(result));
      }, Math.max(0, deadline - Date.now()));

      this._recvWaiters.push(wake);
    });
  }

  static get readTimeoutMs(): number {
    return READ_TIMEOUT_MS;
  }

  static get writeTimeoutMs(): number {
    return WRITE_TIMEOUT_MS;
  }
}

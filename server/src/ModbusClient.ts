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

export class ModbusClient {
  // -- Fields (mirrors ModbusClient.vb private fields) --
  private readonly _clientId: number;
  private _socket: Socket | null = null;
  private _isConnected = false;
  private _ipAddress = '';
  private _port = 0;

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
    this.raiseStatusChanged('Disconnected', false);
  }

  // Exposed for future FC03/FC06/FC16 ports; unused by the connect/disconnect POC.
  get socket(): Socket | null {
    return this._socket;
  }

  static get readTimeoutMs(): number {
    return READ_TIMEOUT_MS;
  }

  static get writeTimeoutMs(): number {
    return WRITE_TIMEOUT_MS;
  }
}

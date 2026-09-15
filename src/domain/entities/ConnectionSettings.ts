import type { ModbusConnectionStatus } from './Modbus';
import type { TransformerRegisterConfig } from './TransformerRegisterMap';

// A sub-device shares its parent Transformer's single TCP socket and is
// distinguished only by its Modbus slave/unit ID (RS 485 - ID), same as a
// real Modbus TCP-to-RTU gateway multiplexes several RTU devices over one
// TCP connection to the master. Each sub-device has its own registerConfig
// since different device types (IRTCC, 2243, Smart Breather, ...) expose
// data at different registers.
export interface SubDevice {
  id: string;
  name: string;
  enabled: boolean;
  slaveId: number;
  registerConfig: TransformerRegisterConfig;
}

// A transformer (TR) is a dashboard panel with its own dedicated connection
// (IP, port) - each TR owns its own TCP socket in the backend gateway
// service, identified by `clientId`, never shared with another TR. Its
// subDevices are the RS-485 devices multiplexed over that one connection.
export interface Transformer {
  id: string;
  clientId: number;
  name: string;
  ipAddress: string;
  port: number;
  status: ModbusConnectionStatus;
  isConnected: boolean;
  isConnecting: boolean;
  errorMessage: string | null;
  subDevices: SubDevice[];
}

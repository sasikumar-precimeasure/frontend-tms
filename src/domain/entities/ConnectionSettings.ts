import type { ModbusConnectionStatus } from './Modbus';
import type { TransformerRegisterConfig } from './TransformerRegisterMap';

// A sub-device shares its parent gateway's single TCP socket and is
// distinguished only by its Modbus slave/unit ID (RS 485 - ID), same as a
// real Modbus TCP-to-RTU gateway multiplexes several RTU devices over one
// TCP connection to the master.
export interface SubDevice {
  id: string;
  name: string;
  enabled: boolean;
  slaveId: number;
}

// A gateway is one physical Ethernet endpoint (IP:port) - one real TCP
// socket, tracked in the backend gateway service by `clientId`.
export interface Gateway {
  id: string;
  clientId: number;
  label: string;
  ipAddress: string;
  port: number;
  status: ModbusConnectionStatus;
  isConnected: boolean;
  isConnecting: boolean;
  errorMessage: string | null;
  subDevices: SubDevice[];
}

// A transformer (TR) is a dashboard panel, linked to one sub-device for its
// live register data (gateway clientId + slaveId come from that sub-device).
// Each TR has its own registerConfig since different TR/device models may
// expose data at different registers.
export interface Transformer {
  id: string;
  name: string;
  linkedGatewayId: string | null;
  linkedSubDeviceId: string | null;
  registerConfig: TransformerRegisterConfig;
}

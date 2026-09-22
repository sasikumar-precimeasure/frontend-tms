import type { ModbusConnectionStatus } from './Modbus';
import type { TransformerRegisterConfig } from './TransformerRegisterMap';
import type { Device2243RegisterConfig } from './Device2243RegisterMap';
import type { MailThresholds } from './MailSettings';

export type DeviceType = 'irtcc' | '2243';

// A sub-device shares its parent Gateway's single TCP socket and is
// distinguished only by its Modbus slave/unit ID (RS 485 - ID), same as a
// real Modbus TCP-to-RTU gateway multiplexes several RTU devices over one
// TCP connection to the master. Each sub-device has its own registerConfig
// since different device types (IRTCC, 2243, Smart Breather, ...) expose
// data at different registers - deviceType discriminates which shape
// registerConfig is (IRTCC's RegisterOffsetMap-based config vs 2243's own,
// genuinely different register layout - see Device2243RegisterMap.ts).
export interface SubDevice {
  id: string;
  name: string;
  enabled: boolean;
  slaveId: number;
  deviceType: DeviceType;
  registerConfig: TransformerRegisterConfig | Device2243RegisterConfig;
  // Mail alert thresholds for this device (mirrors Form1.txt's per-TR
  // email_Settings/email_TR2Settings, applied per-device here instead) -
  // config only for now, see MailSettings.ts.
  mailThresholds: MailThresholds;
}

// A gateway is one real, physical Modbus TCP-to-RTU gateway - its own IP,
// port, and TCP socket in the backend service (identified by `clientId`,
// never shared with another gateway). Its subDevices are the RS-485 devices
// multiplexed over that one connection.
export interface Gateway {
  id: string;
  name: string;
  clientId: number;
  ipAddress: string;
  port: number;
  status: ModbusConnectionStatus;
  isConnected: boolean;
  isConnecting: boolean;
  errorMessage: string | null;
  subDevices: SubDevice[];
}

// A transformer (TR) is a dashboard grouping that can span multiple
// physical gateways (e.g. one gateway for its IRTCC/2243 devices, another
// for a separately-wired accessory panel) - it owns no connection itself,
// each of its gateways owns its own.
export interface Transformer {
  id: string;
  name: string;
  gateways: Gateway[];
}

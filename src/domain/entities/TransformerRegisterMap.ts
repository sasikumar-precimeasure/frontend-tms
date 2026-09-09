// PLACEHOLDER register offsets for the transformer dashboard (FC03 Read Holding
// Registers). Each Transformer carries its own TransformerRegisterConfig, since
// different TR/device models may expose data at different registers - these
// values only seed new TRs and are NOT the real device register map for every
// device; replace per TR once the actual addresses are known.
export interface RegisterOffsetMap {
  otiTemperature: number;
  otiTemperatureMax: number;
  wtiTemperature: number;
  wtiTemperatureMax: number;
  mog: number; // 0 = Closed, 1 = Open
  tapPosition: number;
  tapCount: number;
  ptVoltage: number;
  actualPtVoltage: number;
  operationMode: number; // 0 = Independent, 1 = Auto/other modes TBD
}

export interface TransformerRegisterConfig {
  startAddress: number;
  count: number;
  offsets: RegisterOffsetMap;
}

export const DEFAULT_REGISTER_CONFIG: TransformerRegisterConfig = {
  startAddress: 4001,
  count: 20,
  offsets: {
    otiTemperature: 0,
    otiTemperatureMax: 1,
    wtiTemperature: 2,
    wtiTemperatureMax: 3,
    mog: 4,
    tapPosition: 5,
    tapCount: 6,
    ptVoltage: 7,
    actualPtVoltage: 8,
    operationMode: 9,
  },
};

export interface DashboardReadings {
  otiTemperature: number | null;
  otiTemperatureMax: number | null;
  wtiTemperature: number | null;
  wtiTemperatureMax: number | null;
  mog: number | null;
  tapPosition: number | null;
  tapCount: number | null;
  ptVoltage: number | null;
  actualPtVoltage: number | null;
  operationMode: number | null;
}

export function mapRegistersToReadings(
  registers: number[] | null,
  offsets: RegisterOffsetMap
): DashboardReadings {
  const get = (offset: number): number | null =>
    registers && offset < registers.length ? registers[offset] : null;

  return {
    otiTemperature: get(offsets.otiTemperature),
    otiTemperatureMax: get(offsets.otiTemperatureMax),
    wtiTemperature: get(offsets.wtiTemperature),
    wtiTemperatureMax: get(offsets.wtiTemperatureMax),
    mog: get(offsets.mog),
    tapPosition: get(offsets.tapPosition),
    tapCount: get(offsets.tapCount),
    ptVoltage: get(offsets.ptVoltage),
    actualPtVoltage: get(offsets.actualPtVoltage),
    operationMode: get(offsets.operationMode),
  };
}

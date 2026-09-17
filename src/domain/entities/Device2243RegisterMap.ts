// Register map for the 2243 sub-device, ported from Form1.txt's disp3()
// (TR1) / disp4() (TR2) - both structurally identical, confirming this is a
// fixed device register layout. 2243 reads from its own register array
// (double_byte2 in the source), genuinely separate from IRTCC's - offsets
// here are NOT interchangeable with RegisterOffsetMap in
// TransformerRegisterMap.ts. Offsets stay user-editable in Settings, same
// precedent as every other device type in this app.
export interface Device2243OffsetMap {
  otiTemperature: number;
  wtiTemperature: number;
  otiAlarmSetpoint: number;
  otiAlarmDiff: number;
  otiTripSetpoint: number;
  otiTripDiff: number;
  wtiAlarmSetpoint: number;
  wtiAlarmDiff: number;
  wtiTripSetpoint: number;
  wtiTripDiff: number;
  wtiFan1Setpoint: number;
  wtiFan1Diff: number;
  wtiFan2Setpoint: number;
  wtiFan2Diff: number;
  relayDelay: number;
}

export interface Device2243RegisterConfig {
  startAddress: number;
  count: number;
  offsets: Device2243OffsetMap;
}

// Defaults mirror disp3()/disp4(): double_byte2(0)=OTI, (1)=WTI,
// (4)-(7)=OTI Alarm/Trip SP+Diff, (8)-(11)=WTI Alarm/Trip SP+Diff,
// (20)-(23)=WTI Fan-1/Fan-2 SP+Diff, (87)=Relay Delay.
export const DEFAULT_2243_REGISTER_CONFIG: Device2243RegisterConfig = {
  startAddress: 0,
  count: 88,
  offsets: {
    otiTemperature: 0,
    wtiTemperature: 1,
    otiAlarmSetpoint: 4,
    otiAlarmDiff: 5,
    otiTripSetpoint: 6,
    otiTripDiff: 7,
    wtiAlarmSetpoint: 8,
    wtiAlarmDiff: 9,
    wtiTripSetpoint: 10,
    wtiTripDiff: 11,
    wtiFan1Setpoint: 20,
    wtiFan1Diff: 21,
    wtiFan2Setpoint: 22,
    wtiFan2Diff: 23,
    relayDelay: 87,
  },
};

export interface Device2243Readings {
  otiTemperature: number | 'open' | null;
  wtiTemperature: number | 'open' | null;
  otiAlarmSetpoint: number | null;
  otiAlarmDiff: number | null;
  otiTripSetpoint: number | null;
  otiTripDiff: number | null;
  wtiAlarmSetpoint: number | null;
  wtiAlarmDiff: number | null;
  wtiTripSetpoint: number | null;
  wtiTripDiff: number | null;
  wtiFan1Setpoint: number | null;
  wtiFan1Diff: number | null;
  wtiFan2Setpoint: number | null;
  wtiFan2Diff: number | null;
  relayDelay: number | null;
}

// Signed 16-bit correction, same as TransformerRegisterMap.ts's toSigned16 -
// duplicated locally since this is a small, self-contained device module.
function toSigned16(raw: number): number {
  return raw >= 32768 ? raw - 65536 : raw;
}

// Mirrors disp3()/disp4()'s OTI/WTI temperature decode: signed correction,
// "Open" at raw >= 4050, else /10.
function readTemperature(raw: number | null): number | 'open' | null {
  if (raw === null) return null;
  const signed = toSigned16(raw);
  if (signed >= 4050) return 'open';
  return Math.round((signed / 10) * 10) / 10;
}

// All setpoint/diff fields are stored on the wire as value*10 (validated
// 0.0-150.0 in Form1.txt before the *10 write) - display value is /10.
function readSetpoint(raw: number | null): number | null {
  if (raw === null) return null;
  return Math.round((raw / 10) * 10) / 10;
}

export function map2243RegistersToReadings(
  registers: number[] | null,
  offsets: Device2243OffsetMap
): Device2243Readings {
  const get = (offset: number): number | null =>
    registers && offset >= 0 && offset < registers.length ? registers[offset] : null;

  return {
    otiTemperature: readTemperature(get(offsets.otiTemperature)),
    wtiTemperature: readTemperature(get(offsets.wtiTemperature)),
    otiAlarmSetpoint: readSetpoint(get(offsets.otiAlarmSetpoint)),
    otiAlarmDiff: readSetpoint(get(offsets.otiAlarmDiff)),
    otiTripSetpoint: readSetpoint(get(offsets.otiTripSetpoint)),
    otiTripDiff: readSetpoint(get(offsets.otiTripDiff)),
    wtiAlarmSetpoint: readSetpoint(get(offsets.wtiAlarmSetpoint)),
    wtiAlarmDiff: readSetpoint(get(offsets.wtiAlarmDiff)),
    wtiTripSetpoint: readSetpoint(get(offsets.wtiTripSetpoint)),
    wtiTripDiff: readSetpoint(get(offsets.wtiTripDiff)),
    wtiFan1Setpoint: readSetpoint(get(offsets.wtiFan1Setpoint)),
    wtiFan1Diff: readSetpoint(get(offsets.wtiFan1Diff)),
    wtiFan2Setpoint: readSetpoint(get(offsets.wtiFan2Setpoint)),
    wtiFan2Diff: readSetpoint(get(offsets.wtiFan2Diff)),
    // Relay Delay is raw (0-60 Sec.), no scaling.
    relayDelay: get(offsets.relayDelay),
  };
}

// Field definitions for the setpoint list UI (label, unit, validation range,
// and whether the wire value is *10-scaled) - drives both Device2243Panel's
// render loop and RegisterMapCard's Settings editor, so the two never drift.
export interface Device2243SetpointField {
  key: keyof Omit<Device2243OffsetMap, 'otiTemperature' | 'wtiTemperature'>;
  label: string;
  unit: string;
  min: number;
  max: number;
  scaled: boolean; // true = wire value is display*10
}

export const DEVICE_2243_SETPOINT_FIELDS: Device2243SetpointField[] = [
  { key: 'otiAlarmSetpoint', label: 'OTI Alarm Setpoint', unit: '°C', min: 0, max: 150, scaled: true },
  { key: 'otiAlarmDiff', label: 'OTI Alarm Diff.', unit: '°C', min: 0, max: 150, scaled: true },
  { key: 'otiTripSetpoint', label: 'OTI Trip Setpoint', unit: '°C', min: 0, max: 150, scaled: true },
  { key: 'otiTripDiff', label: 'OTI Trip Diff.', unit: '°C', min: 0, max: 150, scaled: true },
  { key: 'wtiAlarmSetpoint', label: 'WTI Alarm Setpoint', unit: '°C', min: 0, max: 150, scaled: true },
  { key: 'wtiAlarmDiff', label: 'WTI Alarm Diff.', unit: '°C', min: 0, max: 150, scaled: true },
  { key: 'wtiTripSetpoint', label: 'WTI Trip Setpoint', unit: '°C', min: 0, max: 150, scaled: true },
  { key: 'wtiTripDiff', label: 'WTI Trip Diff.', unit: '°C', min: 0, max: 150, scaled: true },
  { key: 'wtiFan1Setpoint', label: 'WTI Fan-1 Setpoint', unit: '°C', min: 0, max: 150, scaled: true },
  { key: 'wtiFan1Diff', label: 'WTI Fan-1 Diff.', unit: '°C', min: 0, max: 150, scaled: true },
  { key: 'wtiFan2Setpoint', label: 'WTI Fan-2 Setpoint', unit: '°C', min: 0, max: 150, scaled: true },
  { key: 'wtiFan2Diff', label: 'WTI Fan-2 Diff.', unit: '°C', min: 0, max: 150, scaled: true },
  { key: 'relayDelay', label: 'Relay Delay', unit: 'Sec.', min: 0, max: 60, scaled: false },
];

// Register offsets for the transformer dashboard (FC03 Read Holding
// Registers). Each Transformer's sub-device carries its own
// TransformerRegisterConfig, since different device types (IRTCC, 2243, ...)
// expose data at different registers - offsets are user-editable in
// Settings and are NOT enforced here; this file only supplies defaults and
// the value-decoding rules (scaling, signed correction, sentinels) that
// mirror the legacy VB app's disp()/disp2() logic for a given raw value.
export interface RegisterOffsetMap {
  otiTemperature: number;
  otiTemperatureMax: number;
  wtiTemperature: number;
  wtiTemperatureMax: number;
  mog: number; // 0 = Closed, 1 = Open
  tapPosition: number;
  tapPositionMax: number; // upper bound register - tap position is only valid when <= this
  tapCount: number;
  ptVoltage: number;
  actualPtVoltage: number;
  // Mode Display (mirrors double_byte(43)): 4 = Off, 1 = Master, 2 = Follower,
  // anything else (3, per Form1.txt) = Independent.
  operationMode: number;
  // Bit-decoded status words. Bit-extraction here is `(word >> bit) & 1`,
  // inferred from usage since the original And_Calc()/And_Ans() bit-decode
  // routine's implementation was not present in the source provided.
  lvBreakerWord: number;
  lvBreakerBit: number;
  hvBreakerWord: number;
  hvBreakerBit: number;
  oltcWord: number;
  oltcBit: number; // 0 = Local, 1 = Remote (inverted vs the other status bits)
  ptFailRegister: number; // direct value, not bit-decoded: 1 = PT Fail
  // Annunciation grid (mirrors Form1.txt's double_byte(1)/(2) "ALARM"/"ALARM 2"
  // words, bit-decoded via And_Calc/And_Ans) - annAlarmWord1 bits 0-9 map to
  // the first 10 tiles, annAlarmWord2 bits 0 and 9 map to the last 2.
  annAlarmWord1: number;
  annAlarmWord2: number;
  // Ack registers (mirrors double_byte(3)/(4), "ALARM ACK"/"ALARM ACK 2") -
  // set on the device once a fault has been acknowledged there.
  annAckWord1: number;
  annAckWord2: number;
  // Hooter Sat (mirrors double_byte(61)): a direct value, not bit-decoded -
  // 0 = OFF, 1 = ON. Rendered as its own annunciation tile.
  annHooterRegister: number;
  // Mute Sat (mirrors double_byte(60)): direct value gating whether the Mute
  // control is shown; writing to annMuteWriteRegister silences the hooter
  // (mirrors Btn_Mute_Click's WriteSingleRegister(..., 0)).
  annMuteRegister: number;
  annMuteWriteRegister: number;
  // AVR controls (mirrors Btn_AvrAuto/Btn_TapRaise/Btn_TapLow/Btn_CfReset's
  // WriteSingleRegister targets). avrModeWriteRegister is also read back to
  // show the current AUTO/MANUAL state, same alias pattern as
  // annMuteRegister/annMuteWriteRegister.
  avrModeWriteRegister: number;
  tapRaiseWriteRegister: number;
  tapLowerWriteRegister: number;
  controlFailResetWriteRegister: number;
  // AVR status word (mirrors double_byte(9), bit-decoded via And_Calc/And_Ans):
  // bit 0 = AFR, bit 1 = Raise Relay, bit 2 = Lower Relay, bit 6 = Over Volt,
  // bit 7 = Under Volt.
  avrStatusWord: number;
}

export interface TransformerRegisterConfig {
  startAddress: number;
  count: number;
  offsets: RegisterOffsetMap;
}

// Defaults mirror ModbusClient.vb / Form1.vb's disp() (IRTCC) register map:
// double_byte(10)=OTI, (11)=WTI, (15)=MOG, (16)/(17)=tap position/max,
// (18)=tap count, (19)=PT voltage, (21)=actual PT voltage, (22)/(23)=OTI/WTI
// max, (2)=breaker/OLTC status word, (9)=AVR status word, (43)=Mode Display,
// (44)/(45)/(46)/(66)=AVR mode/tap raise/tap lower/control fail reset write
// targets, (64)=PT Fail. These are seed values only - each device's offsets
// are independently editable in Settings.
export const DEFAULT_REGISTER_CONFIG: TransformerRegisterConfig = {
  startAddress: 40001,
  count: 80,
  offsets: {
    otiTemperature: 9,
    otiTemperatureMax: 21,
    wtiTemperature: 10,
    wtiTemperatureMax: 22,
    mog: 11,
    tapPosition: 15,
    tapPositionMax: 16,
    tapCount: 17,
    ptVoltage: 18,
    actualPtVoltage: 20,
    operationMode: 42,
    lvBreakerWord: 2,
    lvBreakerBit: 1,
    hvBreakerWord: 2,
    hvBreakerBit: 2,
    oltcWord: 2,
    oltcBit: 3,
    ptFailRegister: 63,
    // Placeholder seed offsets, same as every other field here - independently
    // editable in Settings per device.
    annAlarmWord1: 0,
    annAlarmWord2: 1,
    annAckWord1: 2,
    annAckWord2: 3,
    annHooterRegister: 60,
    annMuteRegister: 59,
    annMuteWriteRegister: 59,
    avrModeWriteRegister: 43,
    tapRaiseWriteRegister: 44,
    tapLowerWriteRegister: 45,
    controlFailResetWriteRegister: 65,
    avrStatusWord: 9,
  },
};

// The 12-tile annunciation grid (fixed labels, per the product decision to
// not build a configurable-label UI like the legacy ipstring(0..19) table).
// Mirrors Form1.txt's TR1 grid exactly: word 1 bits 0-9 -> tiles 0-9, word 2
// bit 0 -> tile 10, bit 9 -> tile 11.
export interface AnnunciationTile {
  label: string;
  word: 1 | 2;
  bit: number;
}

export const ANNUNCIATION_TILES: AnnunciationTile[] = [
  { label: 'OTI Alarm', word: 1, bit: 0 },
  { label: 'WTI Alarm', word: 1, bit: 1 },
  { label: 'MOG Alarm', word: 1, bit: 2 },
  { label: 'Buchholz Alarm', word: 1, bit: 3 },
  { label: 'OTI Trip', word: 1, bit: 4 },
  { label: 'WTI Trip', word: 1, bit: 5 },
  { label: 'MOG Trip', word: 1, bit: 6 },
  { label: 'Buchholz Trip', word: 1, bit: 7 },
  { label: 'OSR Trip', word: 1, bit: 8 },
  { label: 'PRV Trip', word: 1, bit: 9 },
  { label: 'OLTC PRV Trip', word: 2, bit: 0 },
  { label: '110V DC Supply', word: 2, bit: 9 },
];

export interface DashboardReadings {
  otiTemperature: number | null;
  otiTemperatureMax: number | null;
  wtiTemperature: number | null;
  wtiTemperatureMax: number | null;
  mog: number | null;
  tapPosition: number | 'open' | null;
  tapPositionMax: number | null;
  tapCount: number | null;
  // 'open' mirrors the legacy UI's literal "Open" text for an out-of-range/
  // disconnected PT voltage reading - distinct from `null` (read failed
  // entirely), so the UI can show "Open" specifically rather than generic
  // "N/A".
  ptVoltage: number | 'open' | null;
  actualPtVoltage: number | 'open' | null;
  operationMode: OperationMode | null;
  lvBreakerActive: boolean | null;
  hvBreakerActive: boolean | null;
  oltcLocal: boolean | null;
  ptFailActive: boolean | null;
  // Index-aligned with ANNUNCIATION_TILES; null only when the whole read failed.
  annunciation: (boolean | null)[] | null;
  annunciationAck: (boolean | null)[] | null;
  // Raw ack words, needed to read-modify-write a single ack bit via FC06
  // without clobbering the other bits already set in that register.
  annAckWords: [number | null, number | null];
  // Hooter Sat / Mute Sat (direct values, mirrors double_byte(61)/(60)) -
  // hooterActive renders as its own annunciation tile; muteVisible gates
  // whether the Mute control shows, matching Btn_Mute's Visible toggling.
  hooterActive: boolean | null;
  muteVisible: boolean | null;
  // AVR status word (mirrors double_byte(9)) - avrModeIsAuto reads back the
  // same register the AVR Auto/Manual toggle writes to; the rest are
  // read-only indicator lights in the legacy UI (IndiTapRaise/IndiTaplow/
  // UnderVolt/OverVolt), never clicked.
  avrModeIsAuto: boolean | null;
  afrActive: boolean | null;
  raiseRelayActive: boolean | null;
  lowerRelayActive: boolean | null;
  overVoltActive: boolean | null;
  underVoltActive: boolean | null;
}

// Signed 16-bit correction: a Modbus holding register is unsigned (0-65535)
// on the wire; disp() treats values >= 32768 as negative 16-bit ints.
function toSigned16(raw: number): number {
  return raw >= 32768 ? raw - 65536 : raw;
}

// Mirrors disp()'s three-way OTI/WTI/MOG temperature branch: divide by 10,
// then format with one vs two integer digits depending on magnitude - both
// branches return the same numeric value here (formatting is a display
// concern), but the "Open" sentinel (raw >= 4050 after signed correction)
// means the sensor/channel is disconnected, so the reading is unavailable.
function readTemperatureLike(raw: number | null): number | null {
  if (raw === null) return null;
  const signed = toSigned16(raw);
  if (signed >= 4050) return null; // "Open" in the legacy UI
  return Math.round((signed / 10) * 10) / 10;
}

// OTI/WTI Max: same signed correction and scaling as the live reading, but
// disp() never assigns an "Open" fallback value for these - only the raw
// Max textbox shows "Open"; treat out-of-range the same way for consistency.
function readMaxTemperature(raw: number | null): number | null {
  return readTemperatureLike(raw);
}

// Tap position is only valid while 0 < position <= tapMax and position is
// not the "open"/invalid sentinel 32767 - invalid shows the legacy UI's
// literal "Open" text, not a generic unavailable state.
function readTapPosition(rawPosition: number | null, rawMax: number | null): number | 'open' | null {
  if (rawPosition === null) return null;
  if (rawPosition <= 0 || rawPosition === 32767) return 'open';
  if (rawMax !== null && rawPosition > rawMax) return 'open';
  return rawPosition;
}

// PT Voltage: valid only in (4000, 15000), then /100 - out of range shows
// the legacy UI's literal "Open" text, not a generic unavailable state.
function readPtVoltage(raw: number | null): number | 'open' | null {
  if (raw === null) return null;
  if (raw <= 4000 || raw >= 15000) return 'open';
  return Math.round((raw / 100) * 100) / 100;
}

// Actual PT Voltage: valid when > 4000 and not one of the sentinel codes
// used for "not applicable"/error states; scaled /1000 (TR1's scaling in
// the source - TR2 used /10, a genuine inconsistency in the legacy app;
// /1000 was chosen as the canonical default per product decision). Every
// other case (sentinel match or <=4000) shows "Open", same as PT Voltage.
const ACTUAL_PT_VOLTAGE_SENTINELS = new Set([32767, 32766, 32765]);
function readActualPtVoltage(raw: number | null): number | 'open' | null {
  if (raw === null) return null;
  if (raw <= 4000 || ACTUAL_PT_VOLTAGE_SENTINELS.has(raw)) return 'open';
  return Math.round((raw / 1000) * 10) / 10;
}

// Mode Display (mirrors double_byte(43)): 4 = Off, 1 = Master, 2 = Follower,
// anything else (3, per Form1.txt) = Independent.
export type OperationMode = 'Off' | 'Master' | 'Follower' | 'Independent';
function readOperationMode(raw: number | null): OperationMode | null {
  if (raw === null) return null;
  if (raw === 4) return 'Off';
  if (raw === 1) return 'Master';
  if (raw === 2) return 'Follower';
  return 'Independent';
}

function readBit(word: number | null, bit: number): boolean | null {
  if (word === null) return null;
  return ((word >> bit) & 1) === 1;
}

export function mapRegistersToReadings(
  registers: number[] | null,
  offsets: RegisterOffsetMap
): DashboardReadings {
  const get = (offset: number): number | null =>
    registers && offset >= 0 && offset < registers.length ? registers[offset] : null;

  const rawTapPosition = get(offsets.tapPosition);
  const rawTapMax = get(offsets.tapPositionMax);

  const lvBreakerWord = get(offsets.lvBreakerWord);
  const hvBreakerWord = get(offsets.hvBreakerWord);
  const oltcWord = get(offsets.oltcWord);
  const ptFailRaw = get(offsets.ptFailRegister);

  const annAlarmWord1 = get(offsets.annAlarmWord1);
  const annAlarmWord2 = get(offsets.annAlarmWord2);
  const annAckWord1 = get(offsets.annAckWord1);
  const annAckWord2 = get(offsets.annAckWord2);
  const hooterRaw = get(offsets.annHooterRegister);
  const muteRaw = get(offsets.annMuteRegister);
  const avrModeRaw = get(offsets.avrModeWriteRegister);
  const avrStatusWord = get(offsets.avrStatusWord);

  const decodeAnnunciationWords = (word1: number | null, word2: number | null): (boolean | null)[] | null => {
    if (registers === null) return null;
    return ANNUNCIATION_TILES.map((tile) => readBit(tile.word === 1 ? word1 : word2, tile.bit));
  };

  return {
    otiTemperature: readTemperatureLike(get(offsets.otiTemperature)),
    otiTemperatureMax: readMaxTemperature(get(offsets.otiTemperatureMax)),
    wtiTemperature: readTemperatureLike(get(offsets.wtiTemperature)),
    wtiTemperatureMax: readMaxTemperature(get(offsets.wtiTemperatureMax)),
    mog: readTemperatureLike(get(offsets.mog)),
    tapPosition: readTapPosition(rawTapPosition, rawTapMax),
    tapPositionMax: rawTapMax !== null && rawTapMax > 0 && rawTapMax !== 32767 ? rawTapMax : null,
    tapCount: get(offsets.tapCount),
    ptVoltage: readPtVoltage(get(offsets.ptVoltage)),
    actualPtVoltage: readActualPtVoltage(get(offsets.actualPtVoltage)),
    operationMode: readOperationMode(get(offsets.operationMode)),
    lvBreakerActive: readBit(lvBreakerWord, offsets.lvBreakerBit),
    hvBreakerActive: readBit(hvBreakerWord, offsets.hvBreakerBit),
    // oltcBit: 0 = Local, 1 = Remote in the source, so "Local" is the
    // inverse of the decoded bit.
    oltcLocal: oltcWord === null ? null : !readBit(oltcWord, offsets.oltcBit),
    ptFailActive: ptFailRaw === null ? null : ptFailRaw === 1,
    annunciation: decodeAnnunciationWords(annAlarmWord1, annAlarmWord2),
    annunciationAck: decodeAnnunciationWords(annAckWord1, annAckWord2),
    annAckWords: [annAckWord1, annAckWord2],
    hooterActive: hooterRaw === null ? null : hooterRaw !== 0,
    muteVisible: muteRaw === null ? null : muteRaw !== 0,
    // double_byte(44) = 0 -> AUTO, else -> MANUAL (Form1.txt line ~4495).
    avrModeIsAuto: avrModeRaw === null ? null : avrModeRaw === 0,
    afrActive: readBit(avrStatusWord, 0),
    raiseRelayActive: readBit(avrStatusWord, 1),
    lowerRelayActive: readBit(avrStatusWord, 2),
    overVoltActive: readBit(avrStatusWord, 6),
    underVoltActive: readBit(avrStatusWord, 7),
  };
}

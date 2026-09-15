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
  operationMode: number; // 0 = Independent, 1 = Auto/other modes TBD
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
}

export interface TransformerRegisterConfig {
  startAddress: number;
  count: number;
  offsets: RegisterOffsetMap;
}

// Defaults mirror ModbusClient.vb / Form1.vb's disp() (IRTCC) register map:
// double_byte(10)=OTI, (11)=WTI, (15)=MOG, (16)/(17)=tap position/max,
// (18)=tap count, (19)=PT voltage, (21)=actual PT voltage, (22)/(23)=OTI/WTI
// max, (2)=breaker/OLTC status word, (64)=PT Fail. These are seed values
// only - each device's offsets are independently editable in Settings.
export const DEFAULT_REGISTER_CONFIG: TransformerRegisterConfig = {
  startAddress: 4001,
  count: 30,
  offsets: {
    otiTemperature: 10,
    otiTemperatureMax: 22,
    wtiTemperature: 11,
    wtiTemperatureMax: 23,
    mog: 15,
    tapPosition: 16,
    tapPositionMax: 17,
    tapCount: 18,
    ptVoltage: 19,
    actualPtVoltage: 21,
    operationMode: 9,
    lvBreakerWord: 2,
    lvBreakerBit: 1,
    hvBreakerWord: 2,
    hvBreakerBit: 2,
    oltcWord: 2,
    oltcBit: 3,
    ptFailRegister: 64,
    // Placeholder seed offsets, same as every other field here - independently
    // editable in Settings per device.
    annAlarmWord1: 1,
    annAlarmWord2: 3,
    annAckWord1: 4,
    annAckWord2: 5,
    annHooterRegister: 6,
    annMuteRegister: 7,
    annMuteWriteRegister: 7,
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
  tapPosition: number | null;
  tapPositionMax: number | null;
  tapCount: number | null;
  ptVoltage: number | null;
  actualPtVoltage: number | null;
  operationMode: number | null;
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
// not the "open"/invalid sentinel 32767.
function readTapPosition(rawPosition: number | null, rawMax: number | null): number | null {
  if (rawPosition === null) return null;
  if (rawPosition <= 0 || rawPosition === 32767) return null;
  if (rawMax !== null && rawPosition > rawMax) return null;
  return rawPosition;
}

// PT Voltage: valid only in (4000, 15000), then /100.
function readPtVoltage(raw: number | null): number | null {
  if (raw === null) return null;
  if (raw <= 4000 || raw >= 15000) return null;
  return Math.round((raw / 100) * 100) / 100;
}

// Actual PT Voltage: valid when > 4000 and not one of the sentinel codes
// used for "not applicable"/error states; scaled /1000 (TR1's scaling in
// the source - TR2 used /10, a genuine inconsistency in the legacy app;
// /1000 was chosen as the canonical default per product decision).
const ACTUAL_PT_VOLTAGE_SENTINELS = new Set([32767, 32766, 32765]);
function readActualPtVoltage(raw: number | null): number | null {
  if (raw === null) return null;
  if (raw <= 4000 || ACTUAL_PT_VOLTAGE_SENTINELS.has(raw)) return null;
  return Math.round((raw / 1000) * 10) / 10;
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
    operationMode: get(offsets.operationMode),
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
  };
}

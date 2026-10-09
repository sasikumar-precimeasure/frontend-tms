import { useAppDispatch } from '../../../app/store/hooks';
import type { SubDevice } from '../../../domain/entities/ConnectionSettings';
import type { RegisterOffsetMap, TransformerRegisterConfig } from '../../../domain/entities/TransformerRegisterMap';
import type { Device2243OffsetMap, Device2243RegisterConfig } from '../../../domain/entities/Device2243RegisterMap';
import { updateSubDeviceReadConfig, updateSubDeviceRegisterOffset } from '../slice';

const IRTCC_FIELD_LABELS: Record<keyof RegisterOffsetMap, string> = {
  otiTemperature: 'OTI Temperature',
  otiTemperatureMax: 'OTI Max',
  wtiTemperature: 'WTI Temperature',
  wtiTemperatureMax: 'WTI Max',
  mog: 'MOG',
  tapPosition: 'Tap Position',
  tapPositionMax: 'Tap Position Max',
  tapCount: 'Tap Count',
  ptVoltage: 'PT Voltage',
  actualPtVoltage: 'Actual PT Voltage',
  operationMode: 'Operation Mode',
  lvBreakerWord: 'LV Breaker — Status Register',
  lvBreakerBit: 'LV Breaker — Status Bit',
  hvBreakerWord: 'HV Breaker — Status Register',
  hvBreakerBit: 'HV Breaker — Status Bit',
  oltcWord: 'OLTC Local/Remote — Status Register',
  oltcBit: 'OLTC Local/Remote — Status Bit',
  ptFailRegister: 'PT Fail',
  annAlarmWord1: 'Annunciation — Alarm Register 1',
  annAlarmWord2: 'Annunciation — Alarm Register 2',
  annAckWord1: 'Annunciation — Acknowledge Register 1',
  annAckWord2: 'Annunciation — Acknowledge Register 2',
  annHooterRegister: 'Annunciation — Hooter',
  annMuteRegister: 'Annunciation — Mute Visible',
  annMuteWriteRegister: 'Annunciation — Mute Write Target',
  avrModeWriteRegister: 'AVR Mode (Auto/Manual)',
  tapRaiseWriteRegister: 'AVR — Tap Raise',
  tapLowerWriteRegister: 'AVR — Tap Lower',
  controlFailResetWriteRegister: 'AVR — Control Fail Reset',
  controlFailStatusRegister: 'AVR — Control Fail Status',
  avrStatusWord: 'AVR — Status Register',
  avrPtRatio: 'AVR Settings — PT Ratio',
  avrSetVoltage: 'AVR Settings — Set Voltage',
  avrRaiseRelayVoltage: 'AVR Settings — Raise Relay Voltage',
  avrLowRelayVoltage: 'AVR Settings — Low Relay Voltage',
  avrHsForwardVoltage: 'AVR Settings — HS Forward Voltage',
  avrHsBackwardVoltage: 'AVR Settings — HS Backward Voltage',
  avrOverVoltage: 'AVR Settings — Over Voltage',
  avrUnderVoltage: 'AVR Settings — Under Voltage',
  avrPtFailSetpoint: 'AVR Settings — PT Fail',
  avrInitialTime: 'AVR Settings — Initial Time',
  avrSequentialTime: 'AVR Settings — Sequential Time',
  avrHighFwdBwdTime: 'AVR Settings — High Fwd/Bwd Time',
  avrControlFailTime: 'AVR Settings — Control Fail Time',
  avrRelayMomentaryTime: 'AVR Settings — Relay Momentary Time',
};

// Bit-position fields (0-15) are conceptually different from register
// offsets - labeling both "Offset" would be misleading in the UI.
const IRTCC_BIT_FIELDS: Set<keyof RegisterOffsetMap> = new Set(['lvBreakerBit', 'hvBreakerBit', 'oltcBit']);
const IRTCC_FIELD_ORDER = Object.keys(IRTCC_FIELD_LABELS) as (keyof RegisterOffsetMap)[];

const DEVICE_2243_FIELD_LABELS: Record<keyof Device2243OffsetMap, string> = {
  otiTemperature: 'OTI Temperature',
  wtiTemperature: 'WTI Temperature',
  otiAlarmSetpoint: 'OTI Alarm Setpoint',
  otiAlarmDiff: 'OTI Alarm Diff.',
  otiTripSetpoint: 'OTI Trip Setpoint',
  otiTripDiff: 'OTI Trip Diff.',
  wtiAlarmSetpoint: 'WTI Alarm Setpoint',
  wtiAlarmDiff: 'WTI Alarm Diff.',
  wtiTripSetpoint: 'WTI Trip Setpoint',
  wtiTripDiff: 'WTI Trip Diff.',
  wtiFan1Setpoint: 'WTI Fan-1 Setpoint',
  wtiFan1Diff: 'WTI Fan-1 Diff.',
  wtiFan2Setpoint: 'WTI Fan-2 Setpoint',
  wtiFan2Diff: 'WTI Fan-2 Diff.',
  relayDelay: 'Relay Delay',
};
const DEVICE_2243_FIELD_ORDER = Object.keys(DEVICE_2243_FIELD_LABELS) as (keyof Device2243OffsetMap)[];

interface RegisterMapCardProps {
  trId: string;
  gatewayId: string;
  device: SubDevice;
}

// The actual register address a position points to - what a device manual lists.
function RegisterAddress({ address }: { address: number }) {
  return <span className="w-28 text-[11px] text-surface-400 font-mono">= register {address}</span>;
}

export const RegisterMapCard = ({ trId, gatewayId, device }: RegisterMapCardProps) => {
  const dispatch = useAppDispatch();
  const { startAddress, count } = device.registerConfig;
  const is2243 = device.deviceType === '2243';

  // SubDevice.deviceType/registerConfig aren't a true TS discriminated
  // union, so `is2243` above doesn't narrow registerConfig's type - safe to
  // cast per-branch since deviceType is checked at runtime.
  const irtccOffsets = !is2243 ? (device.registerConfig as TransformerRegisterConfig).offsets : null;
  const offsets2243 = is2243 ? (device.registerConfig as Device2243RegisterConfig).offsets : null;

  return (
    <div className="bg-surface-0 rounded-lg border border-surface-200 overflow-hidden">
      <div className="px-4 py-3 bg-surface-50 border-b border-surface-200">
        <p className="text-sm font-semibold text-surface-800">Register Map</p>
        <p className="text-xs text-surface-500 mt-0.5">
          Which registers to read from {device.name}, and where each value sits in them (per device, since device
          layouts can differ).
        </p>
      </div>

      <div className="px-4 py-3 flex flex-wrap items-center gap-4 border-b border-surface-100">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-surface-500" title="Address of the first register to read">
            First register address
          </label>
          <input
            type="number"
            value={startAddress}
            onChange={(e) =>
              dispatch(
                updateSubDeviceReadConfig({
                  trId,
                  gatewayId,
                  deviceId: device.id,
                  startAddress: Number(e.target.value) || 0,
                  count,
                })
              )
            }
            className="w-24 px-2 py-1 text-sm font-mono border border-surface-300 rounded-md"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-surface-500" title="How many registers to read, starting at the first address">
            Registers to read
          </label>
          <input
            type="number"
            value={count}
            onChange={(e) =>
              dispatch(
                updateSubDeviceReadConfig({
                  trId,
                  gatewayId,
                  deviceId: device.id,
                  startAddress,
                  count: Number(e.target.value) || 0,
                })
              )
            }
            className="w-20 px-2 py-1 text-sm font-mono border border-surface-300 rounded-md"
          />
        </div>
      </div>

      <p className="px-4 pt-2 text-[11px] text-surface-500">
        <span className="font-semibold text-surface-600">Position</span> = where the value is within the registers read:
        position 0 is the first register address ({startAddress}), position 1 the next, and so on. The register address it
        points to is shown on the right.
        {!is2243 && (
          <>
            {' '}
            <span className="font-semibold text-surface-600">Bit</span> (0–15) = which bit of that register holds an on/off
            status.
          </>
        )}
      </p>

      <div className="px-4 py-2">
        {is2243 && offsets2243
          ? DEVICE_2243_FIELD_ORDER.map((field) => (
              <div key={field} className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-sm text-surface-600">{DEVICE_2243_FIELD_LABELS[field]}</span>
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-surface-500">Position</label>
                  <input
                    type="number"
                    value={offsets2243[field]}
                    onChange={(e) =>
                      dispatch(
                        updateSubDeviceRegisterOffset({
                          trId,
                          gatewayId,
                          deviceId: device.id,
                          field,
                          offset: Number(e.target.value) || 0,
                        })
                      )
                    }
                    className="w-16 px-2 py-1 text-sm font-mono border border-surface-300 rounded-md"
                  />
                  <RegisterAddress address={startAddress + offsets2243[field]} />
                </div>
              </div>
            ))
          : irtccOffsets &&
            IRTCC_FIELD_ORDER.map((field) => {
              const isBit = IRTCC_BIT_FIELDS.has(field);
              return (
                <div key={field} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-sm text-surface-600">{IRTCC_FIELD_LABELS[field]}</span>
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-medium text-surface-500">{isBit ? 'Bit' : 'Position'}</label>
                    <input
                      type="number"
                      min={isBit ? 0 : undefined}
                      max={isBit ? 15 : undefined}
                      value={irtccOffsets[field]}
                      onChange={(e) =>
                        dispatch(
                          updateSubDeviceRegisterOffset({
                            trId,
                            gatewayId,
                            deviceId: device.id,
                            field,
                            offset: Number(e.target.value) || 0,
                          })
                        )
                      }
                      className="w-16 px-2 py-1 text-sm font-mono border border-surface-300 rounded-md"
                    />
                    {isBit ? (
                      <span className="w-28 text-[11px] text-surface-400">of the register above</span>
                    ) : (
                      <RegisterAddress address={startAddress + irtccOffsets[field]} />
                    )}
                  </div>
                </div>
              );
            })}
      </div>
    </div>
  );
};

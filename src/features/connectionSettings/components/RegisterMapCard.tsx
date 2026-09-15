import { useAppDispatch } from '../../../app/store/hooks';
import type { SubDevice } from '../../../domain/entities/ConnectionSettings';
import type { RegisterOffsetMap } from '../../../domain/entities/TransformerRegisterMap';
import { updateSubDeviceReadConfig, updateSubDeviceRegisterOffset } from '../slice';

const FIELD_LABELS: Record<keyof RegisterOffsetMap, string> = {
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
  lvBreakerWord: 'LV Breaker — Status Word',
  lvBreakerBit: 'LV Breaker — Bit',
  hvBreakerWord: 'HV Breaker — Status Word',
  hvBreakerBit: 'HV Breaker — Bit',
  oltcWord: 'OLTC Local/Remote — Status Word',
  oltcBit: 'OLTC Local/Remote — Bit',
  ptFailRegister: 'PT Fail',
  annAlarmWord1: 'Annunciation — Alarm Word 1',
  annAlarmWord2: 'Annunciation — Alarm Word 2',
  annAckWord1: 'Annunciation — Ack Word 1',
  annAckWord2: 'Annunciation — Ack Word 2',
  annHooterRegister: 'Annunciation — Hooter',
  annMuteRegister: 'Annunciation — Mute Visible',
  annMuteWriteRegister: 'Annunciation — Mute Write Target',
  avrModeWriteRegister: 'AVR Mode (Auto/Manual)',
  tapRaiseWriteRegister: 'AVR — Tap Raise',
  tapLowerWriteRegister: 'AVR — Tap Lower',
  controlFailResetWriteRegister: 'AVR — Control Fail Reset',
  avrStatusWord: 'AVR — Status Word',
};

// Bit-position fields (0-15) are conceptually different from register
// offsets - labeling both "Offset" would be misleading in the UI.
const BIT_FIELDS: Set<keyof RegisterOffsetMap> = new Set(['lvBreakerBit', 'hvBreakerBit', 'oltcBit']);

const FIELD_ORDER = Object.keys(FIELD_LABELS) as (keyof RegisterOffsetMap)[];

interface RegisterMapCardProps {
  trId: string;
  device: SubDevice;
}

export const RegisterMapCard = ({ trId, device }: RegisterMapCardProps) => {
  const dispatch = useAppDispatch();
  const { startAddress, count, offsets } = device.registerConfig;

  return (
    <div className="bg-surface-0 rounded-lg border border-surface-200 overflow-hidden">
      <div className="px-4 py-3 bg-surface-50 border-b border-surface-200">
        <p className="text-sm font-semibold text-surface-800">Register Map</p>
        <p className="text-xs text-surface-500 mt-0.5">
          FC03 read parameters for {device.name} — per-device, since device layouts can differ.
        </p>
      </div>

      <div className="px-4 py-3 flex flex-wrap items-center gap-4 border-b border-surface-100">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-surface-500">Start Address</label>
          <input
            type="number"
            value={startAddress}
            onChange={(e) =>
              dispatch(
                updateSubDeviceReadConfig({
                  trId,
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
          <label className="text-xs font-medium text-surface-500">Count</label>
          <input
            type="number"
            value={count}
            onChange={(e) =>
              dispatch(
                updateSubDeviceReadConfig({
                  trId,
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

      <div className="px-4 py-2">
        {FIELD_ORDER.map((field) => {
          const isBit = BIT_FIELDS.has(field);
          return (
            <div key={field} className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-sm text-surface-600">{FIELD_LABELS[field]}</span>
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-medium text-surface-500">{isBit ? 'Bit' : 'Offset'}</label>
                <input
                  type="number"
                  min={isBit ? 0 : undefined}
                  max={isBit ? 15 : undefined}
                  value={offsets[field]}
                  onChange={(e) =>
                    dispatch(
                      updateSubDeviceRegisterOffset({
                        trId,
                        deviceId: device.id,
                        field,
                        offset: Number(e.target.value) || 0,
                      })
                    )
                  }
                  className="w-16 px-2 py-1 text-sm font-mono border border-surface-300 rounded-md"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

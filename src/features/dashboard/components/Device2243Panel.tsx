import { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import type { Device2243OffsetMap, Device2243Readings } from '../../../domain/entities/Device2243RegisterMap';
import { DEVICE_2243_SETPOINT_FIELDS } from '../../../domain/entities/Device2243RegisterMap';
import { writeRegisterAsync } from '../slice';
import { recordAuditEventAsync } from '../../auditLog/slice';
import { useHistory } from '../hooks/useHistory';
import { Sparkline } from './Sparkline';
import { TemperatureGauge } from './TemperatureGauge';

const TEMP_MIN_C = 0;
const TEMP_MAX_C = 150;

function TemperatureGaugeTile({
  label,
  value,
  unavailable,
}: {
  label: string;
  value: number | null;
  unavailable?: boolean;
}) {
  const history = useHistory(value);
  return (
    <div className="flex flex-col gap-1">
      <TemperatureGauge label={label} value={value} unit="°C" min={TEMP_MIN_C} max={TEMP_MAX_C} unavailable={unavailable} />
      <Sparkline values={history} unavailable={unavailable} />
    </div>
  );
}

interface SetpointRowProps {
  label: string;
  unit: string;
  min: number;
  max: number;
  currentValue: number | null;
  unavailable?: boolean;
  isWriting: boolean;
  onSubmit: (value: number) => void;
}

// One setpoint row: an editable input + OK button, mirroring the legacy
// "type a value, click OK" pattern (Update2243Values on click) rather than
// a live write-on-change - Form1.txt validates client-side before writing
// (MsgBox("Please check the value")) and only sends the write on the
// button click.
function SetpointRow({ label, unit, min, max, currentValue, unavailable, isWriting, onSubmit }: SetpointRowProps) {
  const [draft, setDraft] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const displayValue = draft !== '' ? draft : (currentValue?.toString() ?? '');

  const handleSubmit = () => {
    const parsed = Number(draft !== '' ? draft : currentValue);
    if (draft === '' || Number.isNaN(parsed)) {
      setError('Please enter value');
      return;
    }
    if (parsed < min || parsed > max) {
      setError('Please check the value');
      return;
    }
    setError(null);
    onSubmit(parsed);
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-1 py-2 px-2 -mx-2 rounded-md border-b border-surface-100 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm text-surface-600">{label}</span>
        <input
          type="number"
          value={displayValue}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          disabled={unavailable}
          placeholder={unavailable ? 'N/A' : undefined}
          className="w-24 px-2 py-1 text-sm font-mono border border-surface-300 rounded-md disabled:bg-surface-100 disabled:text-surface-400"
        />
        <span className="text-xs text-surface-500 w-8">{unit}</span>
        <button
          onClick={handleSubmit}
          disabled={unavailable || isWriting}
          className="px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-white hover:bg-primary-700 transition disabled:opacity-50 disabled:pointer-events-none"
        >
          {isWriting ? '…' : 'OK'}
        </button>
      </div>
      {error && <span className="text-[11px] text-status-critical pl-0.5">{error}</span>}
    </div>
  );
}

interface Device2243PanelProps {
  trId: string;
  clientId: number;
  slaveId: number;
  deviceId: string;
  startAddress: number;
  offsets: Device2243OffsetMap;
  readings: Device2243Readings;
  unavailable?: boolean;
}

// Mirrors Form1.txt's disp3()/disp4() + Alarm/Trip SP. tab: live OTI/WTI
// temperature for the 2243 unit, plus its full setpoint list, each writable
// via its own OK button (Update2243Values -> WriteSingleRegister).
export function Device2243Panel({
  trId,
  clientId,
  slaveId,
  deviceId,
  startAddress,
  offsets,
  readings,
  unavailable,
}: Device2243PanelProps) {
  const dispatch = useAppDispatch();
  const writesByKey = useAppSelector((state) => state.dashboard.writesByKey);

  const otiTemp = readings.otiTemperature === 'open' ? null : readings.otiTemperature;
  const wtiTemp = readings.wtiTemperature === 'open' ? null : readings.wtiTemperature;
  const otiUnavailable = unavailable || readings.otiTemperature === 'open';
  const wtiUnavailable = unavailable || readings.wtiTemperature === 'open';

  const handleSetpointWrite = (field: keyof Device2243OffsetMap, label: string, unit: string, scaled: boolean, value: number) => {
    const key = `${trId}:${deviceId}:2243-${field}`;
    const previousValue = readings[field];
    dispatch(
      writeRegisterAsync({
        key,
        clientId,
        slaveId,
        address: startAddress + offsets[field],
        value: scaled ? Math.round(value * 10) : Math.round(value),
      })
    );
    dispatch(
      recordAuditEventAsync({
        eventType: 'DEVICE2243_SETPOINT_CHANGE',
        deviceId,
        fieldName: label,
        oldValue: previousValue?.toString(),
        newValue: value.toString(),
        description: `${label} changed to ${value}${unit}`,
      })
    );
  };

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-3 animate-panel-enter stagger-1">
        <TemperatureGaugeTile label="OTI Temperature" value={otiTemp} unavailable={otiUnavailable} />
        <TemperatureGaugeTile label="WTI Temperature" value={wtiTemp} unavailable={wtiUnavailable} />
      </section>

      <section className="bg-surface-0 rounded-lg border border-surface-200 px-4 py-1 card-hover animate-panel-enter stagger-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-500 pt-2 pb-1">
          Alarm / Trip Setpoints
        </p>
        {DEVICE_2243_SETPOINT_FIELDS.map((field) => {
          const writeKey = `${trId}:${deviceId}:2243-${field.key}`;
          const isWriting = writesByKey[writeKey]?.isWriting ?? false;
          return (
            <SetpointRow
              key={field.key}
              label={field.label}
              unit={field.unit}
              min={field.min}
              max={field.max}
              currentValue={readings[field.key]}
              unavailable={unavailable}
              isWriting={isWriting}
              onSubmit={(value) => handleSetpointWrite(field.key, field.label, field.unit, field.scaled, value)}
            />
          );
        })}
      </section>
    </div>
  );
}

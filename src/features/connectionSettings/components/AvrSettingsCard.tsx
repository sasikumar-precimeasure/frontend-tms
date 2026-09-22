import { useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import type { SubDevice } from '../../../domain/entities/ConnectionSettings';
import type { AvrSettingField, TransformerRegisterConfig } from '../../../domain/entities/TransformerRegisterMap';
import { AVR_SETTING_FIELDS_COLUMN_1, AVR_SETTING_FIELDS_COLUMN_2, mapRegistersToReadings } from '../../../domain/entities/TransformerRegisterMap';
import { readTransformerRegistersAsync, writeRegisterAsync } from '../../dashboard/slice';

// Same cadence as DevicePanel.tsx's dashboard poll - this card uses the same
// readingKey (`${trId}:${device.id}`) so it shares state with the Dashboard
// panel for this device rather than racing a second, differently-timed poll
// against the same registers.
const POLL_INTERVAL_MS = 1000;

interface AvrSettingsCardProps {
  trId: string;
  clientId: number;
  isConnected: boolean;
  device: SubDevice;
}

interface SettingRowProps {
  field: AvrSettingField;
  currentValue: number | null;
  unavailable?: boolean;
  isWriting: boolean;
  onSubmit: (value: number) => void;
}

// Mirrors the legacy AVR SETTINGS group box: an editable input + OK button
// per field, same "type a value, click OK" pattern as Btn_AVR_PTSet and its
// siblings (client-side range check before writing, matching
// MsgBox("Please Enter value") / MsgBox("Please check the value")).
function SettingRow({ field, currentValue, unavailable, isWriting, onSubmit }: SettingRowProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const displayValue = draft !== '' ? draft : (currentValue?.toString() ?? '');

  const handleSubmit = () => {
    const parsed = Number(draft !== '' ? draft : currentValue);
    if (draft === '' || Number.isNaN(parsed)) {
      setError('Please Enter value');
      return;
    }
    if (parsed < field.min || parsed > field.max) {
      setError('Please check the value');
      return;
    }
    setError(null);
    onSubmit(parsed);
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm text-surface-600">{field.label}</span>
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
        <span className="text-xs text-surface-500 w-8">{field.unit}</span>
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

// AVR Settings (Settings > AVR Settings): PT Ratio / voltage setpoints /
// timing setpoints for one IRTCC device, each independently writable via
// its own OK button - mirrors Form1.txt's AVR SETTINGS group box
// (Btn_AVR_PTSet and its siblings, all writing via UpdateValues -> FC06).
// Not a live-polled panel: values are read once on open via a direct FC03
// read against this device's own registers, same connection the Dashboard
// already uses for this device.
export function AvrSettingsCard({ trId, clientId, isConnected, device }: AvrSettingsCardProps) {
  const dispatch = useAppDispatch();
  const writesByKey = useAppSelector((state) => state.dashboard.writesByKey);
  const readingKey = `${trId}:${device.id}`;
  const readState = useAppSelector((state) => state.dashboard.readingsByTrId[readingKey]);

  // AVR Settings only applies to IRTCC devices (2243 has its own, separate
  // Alarm/Trip Setpoints screen) - registerConfig/deviceType aren't a true
  // TS discriminated union, so this cast is safe only because of the
  // runtime check in the caller (AvrSettingsCard is only rendered for
  // deviceType === 'irtcc' devices - see SettingsPage.tsx).
  const config = device.registerConfig as TransformerRegisterConfig;
  const { startAddress, count } = config;

  // Reads independently of the Dashboard's DevicePanel (same readingKey, so
  // opening both at once shares state rather than double-polling) - a user
  // navigating straight to Settings > AVR Settings without visiting the
  // Dashboard first still sees live current values, not a stale placeholder.
  useEffect(() => {
    if (!isConnected) return;
    const poll = () => {
      dispatch(
        readTransformerRegistersAsync({ trId: readingKey, clientId, slaveId: device.slaveId, startAddress, count })
      );
    };
    poll();
    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [readingKey, clientId, isConnected, device.slaveId, startAddress, count, dispatch]);

  const readings = mapRegistersToReadings(readState?.registers ?? null, config.offsets);
  const unavailable = Boolean(readState?.errorMessage) || !isConnected;

  const handleSubmit = (field: AvrSettingField, value: number) => {
    const key = `${trId}:${device.id}:avr-setting-${field.key}`;
    dispatch(
      writeRegisterAsync({
        key,
        clientId,
        slaveId: device.slaveId,
        address: config.startAddress + config.offsets[field.key],
        value: field.scaled ? Math.round(value * 10) : Math.round(value),
      })
    );
  };

  return (
    <div className="bg-surface-0 rounded-lg border border-surface-200 overflow-hidden">
      <div className="px-4 py-3 bg-surface-50 border-b border-surface-200">
        <p className="text-sm font-semibold text-surface-800">AVR Settings</p>
        <p className="text-xs text-surface-500 mt-0.5">{device.name}</p>
      </div>

      {!isConnected && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-surface-100 text-surface-500 text-xs font-medium">
          This device&apos;s gateway isn&apos;t connected - connect it in Connection Settings to load current values.
        </div>
      )}
      {isConnected && readState?.errorMessage && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-status-critical-soft text-status-critical text-xs font-medium">
          {readState.errorMessage}
        </div>
      )}

      <div className="px-4 py-2 grid grid-cols-1 md:grid-cols-2 gap-x-8 divide-y divide-surface-100 md:divide-y-0">
        <div className="divide-y divide-surface-100">
          {AVR_SETTING_FIELDS_COLUMN_1.map((field) => {
            const writeKey = `${trId}:${device.id}:avr-setting-${field.key}`;
            return (
              <SettingRow
                key={field.key}
                field={field}
                currentValue={readings[field.readingsKey]}
                unavailable={unavailable}
                isWriting={writesByKey[writeKey]?.isWriting ?? false}
                onSubmit={(value) => handleSubmit(field, value)}
              />
            );
          })}
        </div>
        <div className="divide-y divide-surface-100">
          {AVR_SETTING_FIELDS_COLUMN_2.map((field) => {
            const writeKey = `${trId}:${device.id}:avr-setting-${field.key}`;
            return (
              <SettingRow
                key={field.key}
                field={field}
                currentValue={readings[field.readingsKey]}
                unavailable={unavailable}
                isWriting={writesByKey[writeKey]?.isWriting ?? false}
                onSubmit={(value) => handleSubmit(field, value)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

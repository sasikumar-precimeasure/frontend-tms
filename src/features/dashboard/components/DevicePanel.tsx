import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import type { SubDevice } from '../../../domain/entities/ConnectionSettings';
import type { RegisterOffsetMap, DashboardReadings } from '../../../domain/entities/TransformerRegisterMap';
import { mapRegistersToReadings } from '../../../domain/entities/TransformerRegisterMap';
import type { Device2243RegisterConfig } from '../../../domain/entities/Device2243RegisterMap';
import { map2243RegistersToReadings } from '../../../domain/entities/Device2243RegisterMap';
import { readTransformerRegistersAsync, writeRegisterAsync } from '../slice';
import { useValueFlash } from '../hooks/useValueFlash';
import { useHistory } from '../hooks/useHistory';
import { Sparkline } from './Sparkline';
import { TemperatureGauge } from './TemperatureGauge';
import { DevicePanelSettingsDrawer } from './DevicePanelSettingsDrawer';
import { Device2243Panel } from './Device2243Panel';

// Rough operating band for the temperature fill bar - a purely visual cue,
// not a real alarm threshold (those aren't wired up yet).
// Matches Form1.txt's OTI/WTI setpoint validation range (0.0-150.0).
const TEMP_MIN_C = 0;
const TEMP_MAX_C = 150;

const POLL_INTERVAL_MS = 1000;

// Every section below is memoized so a poll tick (every 1s, regardless of
// whether any value actually changed) or a write in one section doesn't
// visibly re-render unrelated sections - React skips a memoized component
// entirely unless its own props changed. This was the cause of clicking
// e.g. AVR Mode appearing to flicker/update the whole panel.

const ReadingTile = memo(function ReadingTile({
  label,
  value,
  unit,
  unavailable,
  showFill,
}: {
  label: string;
  value: number | null;
  unit?: string;
  unavailable?: boolean;
  showFill?: boolean;
}) {
  const flashing = useValueFlash(value);
  const fillPercent =
    showFill && value !== null
      ? Math.max(0, Math.min(100, ((value - TEMP_MIN_C) / (TEMP_MAX_C - TEMP_MIN_C)) * 100))
      : null;

  return (
    <div
      className={`relative flex flex-col gap-1 px-4 py-3 bg-surface-0 rounded-lg border overflow-hidden ${unavailable ? 'border-status-critical/30' : 'border-surface-200'} ${flashing ? 'animate-value-flash' : ''}`}
    >
      {fillPercent !== null && (
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 bg-primary/10 transition-[height] duration-700 ease-out"
          style={{ height: `${fillPercent}%` }}
        />
      )}
      <span className="relative text-[11px] font-semibold uppercase tracking-wider text-surface-500">{label}</span>
      <span
        className={`relative font-mono tabular-nums text-2xl font-semibold transition-colors duration-300 ${unavailable ? 'text-status-critical/60' : 'text-surface-900'}`}
      >
        {value === null ? (unavailable ? 'N/A' : '—') : value}
        {value !== null && unit && <span className="text-base font-medium text-surface-400 ml-0.5">{unit}</span>}
      </span>
    </div>
  );
});

const TemperatureGaugeTile = memo(function TemperatureGaugeTile({
  label,
  value,
  unit,
  unavailable,
}: {
  label: string;
  value: number | null;
  unit?: string;
  unavailable?: boolean;
}) {
  const history = useHistory(value);
  return (
    <div className="flex flex-col gap-1">
      <TemperatureGauge
        label={label}
        value={value}
        unit={unit}
        min={TEMP_MIN_C}
        max={TEMP_MAX_C}
        unavailable={unavailable}
      />
      <Sparkline values={history} unavailable={unavailable} />
    </div>
  );
});

function RowIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} className="shrink-0 text-surface-400" fill="none" aria-hidden>
      {children}
    </svg>
  );
}

const ROW_ICONS: Record<string, ReactNode> = {
  operationMode: (
    <RowIcon>
      <path d="M8 1v3M8 12v3M1 8h3M12 8h3M3.5 3.5l2 2M10.5 10.5l2 2M12.5 3.5l-2 2M5.5 10.5l-2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </RowIcon>
  ),
  tapCount: (
    <RowIcon>
      <path d="M2 13V3M2 3l3 3M2 3l-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" transform="translate(1 0)" />
      <path d="M6 5h8M6 8h8M6 11h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </RowIcon>
  ),
  ptVoltage: (
    <RowIcon>
      <path d="M9 1 3 9h4l-1 6 6-8H8l1-6Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </RowIcon>
  ),
  actualPtVoltage: (
    <RowIcon>
      <path d="M9 1 3 9h4l-1 6 6-8H8l1-6Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </RowIcon>
  ),
};

const StatValue = memo(function StatValue({
  label,
  value,
  unavailable,
  icon,
}: {
  label: string;
  value: ReactNode;
  unavailable?: boolean;
  icon?: ReactNode;
}) {
  const flashing = useValueFlash(value);
  return (
    <div
      className={`flex items-center justify-between gap-3 py-2 px-2 -mx-2 rounded-md border-b border-surface-100 last:border-b-0 ${flashing ? 'animate-value-flash' : ''}`}
    >
      <span className="flex items-center gap-2 text-sm text-surface-600">
        {icon}
        {label}
      </span>
      <span
        className={`font-mono tabular-nums text-sm font-semibold transition-colors duration-300 ${unavailable ? 'text-status-critical/60' : 'text-surface-900'}`}
      >
        {unavailable ? 'N/A' : value}
      </span>
    </div>
  );
});

const MogRow = memo(function MogRow({ value, unavailable }: { value: number | null; unavailable?: boolean }) {
  const flashing = useValueFlash(value);
  const percent = value !== null ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div
      className={`py-2 px-2 -mx-2 rounded-md border-b border-surface-100 last:border-b-0 ${flashing ? 'animate-value-flash' : ''}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-surface-600">MOG</span>
        <span
          className={`font-mono tabular-nums text-sm font-semibold transition-colors duration-300 ${unavailable ? 'text-status-critical/60' : 'text-surface-900'}`}
        >
          {unavailable || value === null ? 'N/A' : `${value}%`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-surface-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
          style={{ width: `${unavailable ? 0 : percent}%` }}
        />
      </div>
    </div>
  );
});

const TapPositionRow = memo(function TapPositionRow({
  position,
  max,
  unavailable,
}: {
  position: number | 'open' | null;
  max: number | null;
  unavailable?: boolean;
}) {
  const flashing = useValueFlash(position);
  const dotCount = max !== null && max > 0 && max <= 20 ? max : null;
  const numericPosition = typeof position === 'number' ? position : null;

  return (
    <div
      className={`py-2 px-2 -mx-2 rounded-md border-b border-surface-100 last:border-b-0 ${flashing ? 'animate-value-flash' : ''}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-surface-600">Tap Position</span>
        <span
          className={`font-mono tabular-nums text-sm font-semibold transition-colors duration-300 ${unavailable ? 'text-status-critical/60' : 'text-surface-900'}`}
        >
          {unavailable || position === null ? 'N/A' : position === 'open' ? 'Open' : position}
        </span>
      </div>
      {dotCount !== null && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {Array.from({ length: dotCount }, (_, i) => {
            const filled = !unavailable && numericPosition !== null && i < numericPosition;
            return (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${filled ? 'bg-primary' : 'bg-surface-200'}`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});

function ActionButton({
  children,
  tone = 'neutral',
  disabled,
  onClick,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'primary' | 'good' | 'critical';
  disabled?: boolean;
  onClick: () => void;
}) {
  const toneStyles: Record<string, string> = {
    neutral: 'bg-surface-0 border border-surface-300 text-surface-700 hover:bg-surface-50',
    primary: 'bg-primary text-white hover:bg-primary-700',
    good: 'bg-status-good-soft text-status-good border border-status-good/20 hover:bg-status-good/10',
    critical: 'bg-status-critical-soft text-status-critical border border-status-critical/20 hover:bg-status-critical/10',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-2 text-xs font-semibold rounded-md transition disabled:opacity-50 disabled:pointer-events-none ${toneStyles[tone]}`}
    >
      {children}
    </button>
  );
}

const StatusChip = memo(function StatusChip({ label, active }: { label: string; active: boolean | null }) {
  const styles =
    active === null
      ? 'bg-surface-100 text-surface-400'
      : active
        ? 'bg-status-critical-soft text-status-critical'
        : 'bg-status-good-soft text-status-good';
  const dotStyle =
    active === null ? 'bg-surface-300' : active ? 'bg-status-critical status-glow' : 'bg-status-good';

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs font-semibold ${styles}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotStyle}`} />
      {label}
    </div>
  );
});

interface AvrControlsProps {
  avrModeIsAuto: boolean | null;
  controlFailActive: boolean | null;
  isAvrModeWriting: boolean;
  isTapRaiseWriting: boolean;
  isTapLowerWriting: boolean;
  isCfResetWriting: boolean;
  onAvrModeToggle: () => void;
  onTapRaise: () => void;
  onTapLower: () => void;
  onControlFailReset: () => void;
}

// Memoized as one unit (the 4 buttons only ever change together via the
// same readings) so clicking one doesn't cause sibling sections (temperature
// gauges, stat rows, status chips) to re-render - only AvrControls itself
// re-renders, and only when its own props actually changed.
const AvrControls = memo(function AvrControls({
  avrModeIsAuto,
  controlFailActive,
  isAvrModeWriting,
  isTapRaiseWriting,
  isTapLowerWriting,
  isCfResetWriting,
  onAvrModeToggle,
  onTapRaise,
  onTapLower,
  onControlFailReset,
}: AvrControlsProps) {
  return (
    <section className="bg-surface-0 rounded-lg border border-surface-200 p-4 space-y-3 animate-panel-enter stagger-3 card-hover">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-500">AVR Mode</p>
      <div className="flex flex-wrap gap-2">
        <ActionButton tone="primary" disabled={isAvrModeWriting} onClick={onAvrModeToggle}>
          AVR Mode: {avrModeIsAuto === null ? '—' : avrModeIsAuto ? 'AUTO' : 'MANUAL'}
        </ActionButton>
        {avrModeIsAuto === false && (
          <>
            <ActionButton disabled={isTapRaiseWriting} onClick={onTapRaise}>
              Tap Raise
            </ActionButton>
            <ActionButton disabled={isTapLowerWriting} onClick={onTapLower}>
              Tap Lower
            </ActionButton>
          </>
        )}
        {controlFailActive && (
          <ActionButton tone="critical" disabled={isCfResetWriting} onClick={onControlFailReset}>
            Control Fail Reset
          </ActionButton>
        )}
      </div>
    </section>
  );
});

interface DevicePanelProps {
  trId: string;
  clientId: number;
  isConnected: boolean;
  device: SubDevice;
}

// One full dashboard page for a single device (IRTCC, 2243, ...) belonging
// to a transformer - polled and rendered independently.
export const DevicePanel = ({ trId, clientId, isConnected, device }: DevicePanelProps) => {
  const dispatch = useAppDispatch();
  const readingKey = `${trId}:${device.id}`;
  const readState = useAppSelector((state) => state.dashboard.readingsByTrId[readingKey]);
  const writesByKey = useAppSelector((state) => state.dashboard.writesByKey);
  const { startAddress, count } = device.registerConfig;
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!isConnected) return;

    const poll = () => {
      dispatch(
        readTransformerRegistersAsync({
          trId: readingKey,
          clientId,
          slaveId: device.slaveId,
          startAddress,
          count,
        })
      );
    };

    poll();
    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [readingKey, clientId, isConnected, device.slaveId, startAddress, count, dispatch]);

  const isByteCountMismatch = readState?.errorMessage?.includes('Unexpected byte count') ?? false;
  const hasReadError = Boolean(readState?.errorMessage);

  // 2243 has its own register layout and UI (OTI/WTI + Alarm/Trip Setpoint
  // list, per Form1.txt's disp3()/disp4()) - genuinely different from
  // IRTCC's, so it renders through its own component rather than branching
  // deep inside this one.
  if (device.deviceType === '2243') {
    // SubDevice.deviceType/registerConfig aren't a true TS discriminated
    // union (registerConfig's type isn't keyed off deviceType), so this
    // check doesn't narrow the union - safe to cast here since we've just
    // verified deviceType at runtime.
    const config2243 = device.registerConfig as Device2243RegisterConfig;
    const readings2243 = map2243RegistersToReadings(readState?.registers ?? null, config2243.offsets);
    return (
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-surface-800">{device.name}</p>
        </div>
        {!isConnected && (
          <div className="px-4 py-2.5 rounded-lg bg-surface-100 text-surface-500 text-sm font-medium">
            Not connected. Connect this transformer in Settings to see live readings.
          </div>
        )}
        {readState?.errorMessage && isByteCountMismatch && (
          <div className="px-4 py-2.5 rounded-lg bg-status-critical-soft text-status-critical text-sm font-medium">
            Device returned a different amount of data than requested — the register count in Settings for{' '}
            {device.name} likely doesn&apos;t match this device. Readings below are unavailable until fixed.
          </div>
        )}
        {readState?.errorMessage && !isByteCountMismatch && (
          <div className="px-4 py-2.5 rounded-lg bg-status-critical-soft text-status-critical text-sm font-medium">
            {readState.errorMessage}
          </div>
        )}
        <Device2243Panel
          trId={trId}
          clientId={clientId}
          slaveId={device.slaveId}
          deviceId={device.id}
          startAddress={config2243.startAddress}
          offsets={config2243.offsets}
          readings={readings2243}
          unavailable={hasReadError}
        />
      </div>
    );
  }

  // TS can't narrow the union from the `deviceType === '2243'` early return
  // above (it returned inside an `if`, not via a discriminated-union guard
  // clause TS tracks across the whole function) - safe in practice since
  // that branch already handled every 2243 device.
  const offsets = device.registerConfig.offsets as RegisterOffsetMap;
  const readings = mapRegistersToReadings(readState?.registers ?? null, offsets);

  const avrModeKey = `${trId}:${device.id}:avr-mode`;
  const tapRaiseKey = `${trId}:${device.id}:tap-raise`;
  const tapLowerKey = `${trId}:${device.id}:tap-lower`;
  const cfResetKey = `${trId}:${device.id}:cf-reset`;

  // Read the latest readings/offsets via a ref (updated in an effect below,
  // not during render) so the write callbacks' identities stay stable
  // across polls - otherwise AvrControls would lose its memoization every
  // ~1s even when nothing about the AVR state actually changed.
  const latestRef = useRef({ readings, offsets, startAddress });
  useEffect(() => {
    latestRef.current = { readings, offsets, startAddress };
  }, [readings, offsets, startAddress]);

  // Mirrors Btn_AvrAuto/Btn_TapRaise/Btn_TapLow/Btn_CfReset_Click: each is
  // confirmation-gated in the legacy app before writing (role-gating isn't
  // ported since this app has no role system yet). Address is
  // startAddress + offset, same convention as every other register in this
  // app (offsets default to 43/44/45/65, landing on 40044/40045/40046/40066
  // per Form1.txt given the default startAddress of 40001).
  const writeAvrControl = useCallback(
    (key: string, confirmMessage: string, offset: number, value: number) => {
      if (!window.confirm(confirmMessage)) return;
      dispatch(
        writeRegisterAsync({
          key: `${trId}:${device.id}:${key}`,
          clientId,
          slaveId: device.slaveId,
          address: latestRef.current.startAddress + offset,
          value,
        })
      );
    },
    [dispatch, trId, device.id, clientId, device.slaveId]
  );

  const handleAvrModeToggle = useCallback(() => {
    const { readings: r, offsets: o } = latestRef.current;
    writeAvrControl(
      'avr-mode',
      r.avrModeIsAuto ? 'Switch AVR mode to MANUAL?' : 'Switch AVR mode to AUTO?',
      o.avrModeWriteRegister,
      // Btn_AvrAuto_Click: sends 1 when currently AUTO (switching to
      // Manual), 0 when currently Manual (switching to Auto).
      r.avrModeIsAuto ? 1 : 0
    );
  }, [writeAvrControl]);

  const handleTapRaise = useCallback(() => {
    writeAvrControl('tap-raise', 'Are you sure you want to Raise Tap?', latestRef.current.offsets.tapRaiseWriteRegister, 1);
  }, [writeAvrControl]);

  const handleTapLower = useCallback(() => {
    writeAvrControl('tap-lower', 'Are you sure you want to Lower Tap?', latestRef.current.offsets.tapLowerWriteRegister, 1);
  }, [writeAvrControl]);

  const handleControlFailReset = useCallback(() => {
    writeAvrControl(
      'cf-reset',
      'Are you sure you want to Reset?',
      latestRef.current.offsets.controlFailResetWriteRegister,
      0
    );
  }, [writeAvrControl]);

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-surface-800">{device.name}</p>
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label={`${device.name} settings`}
          className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full text-surface-500 hover:bg-surface-100 hover:text-surface-700 transition"
        >
          <svg viewBox="0 0 24 24" width={18} height={18} fill="none" aria-hidden>
            <path
              d="M19.4 13a7.6 7.6 0 0 0 .07-1 7.6 7.6 0 0 0-.07-1l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.4.96a7.5 7.5 0 0 0-1.73-1l-.36-2.55A.5.5 0 0 0 14.05 2h-3.84a.5.5 0 0 0-.5.43l-.36 2.55a7.5 7.5 0 0 0-1.73 1l-2.4-.96a.5.5 0 0 0-.6.22L2.7 8.56a.5.5 0 0 0 .12.64L4.85 10.8a7.6 7.6 0 0 0 0 2l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.4-.96a7.5 7.5 0 0 0 1.73 1l.36 2.55a.5.5 0 0 0 .5.43h3.84a.5.5 0 0 0 .5-.43l.36-2.55a7.5 7.5 0 0 0 1.73-1l2.4.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64L19.4 13Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
      </div>

      {!isConnected && (
        <div className="px-4 py-2.5 rounded-lg bg-surface-100 text-surface-500 text-sm font-medium">
          Not connected. Connect this transformer in Settings to see live readings.
        </div>
      )}
      {readState?.errorMessage && isByteCountMismatch && (
        <div className="px-4 py-2.5 rounded-lg bg-status-critical-soft text-status-critical text-sm font-medium">
          Device returned a different amount of data than requested — the register count in Settings for{' '}
          {device.name} likely doesn&apos;t match this device. Readings below are unavailable until fixed.
        </div>
      )}
      {readState?.errorMessage && !isByteCountMismatch && (
        <div className="px-4 py-2.5 rounded-lg bg-status-critical-soft text-status-critical text-sm font-medium">
          {readState.errorMessage}
        </div>
      )}

      {/* Temperatures */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-panel-enter stagger-1">
        <TemperatureGaugeTile
          label="OTI Temperature"
          value={readings.otiTemperature}
          unit="°C"
          unavailable={hasReadError}
        />
        <ReadingTile
          label="OTI Max"
          value={readings.otiTemperatureMax}
          unit="°C"
          unavailable={hasReadError}
          showFill
        />
        <TemperatureGaugeTile
          label="WTI Temperature"
          value={readings.wtiTemperature}
          unit="°C"
          unavailable={hasReadError}
        />
        <ReadingTile
          label="WTI Max"
          value={readings.wtiTemperatureMax}
          unit="°C"
          unavailable={hasReadError}
          showFill
        />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 animate-panel-enter stagger-2">
        {/* Mechanical state */}
        <section className="bg-surface-0 rounded-lg border border-surface-200 px-4 py-1 card-hover">
          <MogRow value={readings.mog} unavailable={hasReadError} />
          <StatValue
            label="Operation Mode"
            value={readings.operationMode ?? '—'}
            unavailable={hasReadError}
            icon={ROW_ICONS.operationMode}
          />
          <TapPositionRow position={readings.tapPosition} max={readings.tapPositionMax} unavailable={hasReadError} />
          <StatValue
            label="Tap Count"
            value={readings.tapCount ?? '—'}
            unavailable={hasReadError}
            icon={ROW_ICONS.tapCount}
          />
        </section>

        {/* Electrical */}
        <section className="bg-surface-0 rounded-lg border border-surface-200 px-4 py-1 card-hover">
          <StatValue
            label="PT Voltage"
            value={readings.ptVoltage === null ? '—' : readings.ptVoltage === 'open' ? 'Open' : `${readings.ptVoltage} V`}
            unavailable={hasReadError}
            icon={ROW_ICONS.ptVoltage}
          />
          <StatValue
            label="Actual PT Voltage"
            value={
              readings.actualPtVoltage === null
                ? '—'
                : readings.actualPtVoltage === 'open'
                  ? 'Open'
                  : `${readings.actualPtVoltage} V`
            }
            unavailable={hasReadError}
            icon={ROW_ICONS.actualPtVoltage}
          />
        </section>
      </div>

      {/* AVR controls - each writes a real register via FC06, mirroring
          Btn_AvrAuto/Btn_TapRaise/Btn_TapLow/Btn_CfReset_Click */}
      <AvrControls
        avrModeIsAuto={readings.avrModeIsAuto}
        controlFailActive={readings.controlFailActive}
        isAvrModeWriting={writesByKey[avrModeKey]?.isWriting ?? false}
        isTapRaiseWriting={writesByKey[tapRaiseKey]?.isWriting ?? false}
        isTapLowerWriting={writesByKey[tapLowerKey]?.isWriting ?? false}
        isCfResetWriting={writesByKey[cfResetKey]?.isWriting ?? false}
        onAvrModeToggle={handleAvrModeToggle}
        onTapRaise={handleTapRaise}
        onTapLower={handleTapLower}
        onControlFailReset={handleControlFailReset}
      />

      {/* Status - bit-decoded from the configured breaker/OLTC/PT-fail/AVR registers */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-panel-enter stagger-4">
        <StatusChip label="LV Circuit Breaker" active={hasReadError ? null : readings.lvBreakerActive} />
        <StatusChip label="HV Circuit Breaker" active={hasReadError ? null : readings.hvBreakerActive} />
        <StatusChip label="PT Fail" active={hasReadError ? null : readings.ptFailActive} />
        <StatusChip label="OLTC Local" active={hasReadError ? null : readings.oltcLocal} />
        <StatusChip label="AFR" active={hasReadError ? null : readings.afrActive} />
        <StatusChip label="Raise Relay" active={hasReadError ? null : readings.raiseRelayActive} />
        <StatusChip label="Lower Relay" active={hasReadError ? null : readings.lowerRelayActive} />
        <StatusChip label="Over Volt" active={hasReadError ? null : readings.overVoltActive} />
        <StatusChip label="Under Volt" active={hasReadError ? null : readings.underVoltActive} />
      </section>

      {settingsOpen && (
        <DevicePanelSettingsDrawer
          trId={trId}
          clientId={clientId}
          device={device}
          readings={readings}
          unavailable={hasReadError}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
};

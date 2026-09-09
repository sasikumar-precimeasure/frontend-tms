import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import type { Transformer } from '../../../domain/entities/ConnectionSettings';
import { mapRegistersToReadings } from '../../../domain/entities/TransformerRegisterMap';
import { readTransformerRegistersAsync } from '../slice';
import { useValueFlash } from '../hooks/useValueFlash';
import { useHistory } from '../hooks/useHistory';
import { Sparkline } from './Sparkline';

// Rough operating band for the temperature fill bar - a purely visual cue,
// not a real alarm threshold (those aren't wired up yet).
const TEMP_MIN_C = 20;
const TEMP_MAX_C = 90;

const POLL_INTERVAL_MS = 1000;

interface TransformerPanelProps {
  transformer: Transformer;
}

// Placeholder for AVR/relay/mute controls - FC06 (Write Single Register)
// hasn't been implemented yet, so these render but don't send anything.
const NOT_IMPLEMENTED = () => {
  /* needs FC06 write support */
};

function ReadingTile({
  label,
  value,
  unit,
  unavailable,
  showFill,
  showTrend,
}: {
  label: string;
  value: number | null;
  unit?: string;
  unavailable?: boolean;
  showFill?: boolean;
  showTrend?: boolean;
}) {
  const flashing = useValueFlash(value);
  const history = useHistory(showTrend ? value : null);
  const fillPercent =
    showFill && value !== null
      ? Math.max(0, Math.min(100, ((value - TEMP_MIN_C) / (TEMP_MAX_C - TEMP_MIN_C)) * 100))
      : null;

  return (
    <div
      className={`relative flex flex-col gap-1 px-4 py-3 bg-white rounded-lg border overflow-hidden ${unavailable ? 'border-status-critical/30' : 'border-surface-200'} ${flashing ? 'animate-value-flash' : ''}`}
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
      {showTrend && <Sparkline values={history} unavailable={unavailable} />}
    </div>
  );
}

function StatValue({ label, value, unavailable }: { label: string; value: ReactNode; unavailable?: boolean }) {
  const flashing = useValueFlash(value);
  return (
    <div
      className={`flex items-center justify-between gap-3 py-2 px-2 -mx-2 rounded-md border-b border-surface-100 last:border-b-0 ${flashing ? 'animate-value-flash' : ''}`}
    >
      <span className="text-sm text-surface-600">{label}</span>
      <span
        className={`font-mono tabular-nums text-sm font-semibold transition-colors duration-300 ${unavailable ? 'text-status-critical/60' : 'text-surface-900'}`}
      >
        {unavailable ? 'N/A' : value}
      </span>
    </div>
  );
}

function ActionButton({
  children,
  tone = 'neutral',
  onClick,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'primary' | 'good' | 'critical';
  onClick: () => void;
}) {
  const toneStyles: Record<string, string> = {
    neutral: 'bg-white border border-surface-300 text-surface-700 hover:bg-surface-50',
    primary: 'bg-primary text-white hover:bg-primary-700',
    good: 'bg-status-good-soft text-status-good border border-status-good/20 hover:bg-status-good/10',
    critical: 'bg-status-critical-soft text-status-critical border border-status-critical/20 hover:bg-status-critical/10',
  };

  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-xs font-semibold rounded-md transition ${toneStyles[tone]}`}
    >
      {children}
    </button>
  );
}

function StatusChip({ label, active }: { label: string; active: boolean | null }) {
  const styles =
    active === null
      ? 'bg-surface-100 text-surface-400'
      : active
        ? 'bg-status-critical-soft text-status-critical'
        : 'bg-status-good-soft text-status-good';
  const dotStyle = active === null ? 'bg-surface-300' : active ? 'bg-status-critical' : 'bg-status-good';

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs font-semibold ${styles}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotStyle}`} />
      {label}
    </div>
  );
}

export const TransformerPanel = ({ transformer }: TransformerPanelProps) => {
  const dispatch = useAppDispatch();
  const gateways = useAppSelector((state) => state.connectionSettings.gateways);
  const trReadState = useAppSelector((state) => state.dashboard.readingsByTrId[transformer.id]);

  const gateway = gateways.find((g) => g.id === transformer.linkedGatewayId);
  const subDevice = gateway?.subDevices.find((d) => d.id === transformer.linkedSubDeviceId);
  const isLinked = Boolean(gateway && subDevice);

  const { startAddress, count } = transformer.registerConfig;

  useEffect(() => {
    if (!gateway || !subDevice || !gateway.isConnected) return;

    const poll = () => {
      dispatch(
        readTransformerRegistersAsync({
          trId: transformer.id,
          clientId: gateway.clientId,
          slaveId: subDevice.slaveId,
          startAddress,
          count,
        })
      );
    };

    poll();
    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transformer.id, gateway?.clientId, gateway?.isConnected, subDevice?.slaveId, startAddress, count, dispatch]);

  const readings = mapRegistersToReadings(trReadState?.registers ?? null, transformer.registerConfig.offsets);

  const isByteCountMismatch = trReadState?.errorMessage?.includes('Unexpected byte count') ?? false;
  const hasReadError = Boolean(trReadState?.errorMessage);

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-5 animate-panel-enter">
      {!isLinked && (
        <div className="px-4 py-2.5 rounded-lg bg-status-warn-soft text-status-warn text-sm font-medium">
          Not linked to a device — configure this in Settings &rarr; Connection Settings.
        </div>
      )}
      {isLinked && gateway && !gateway.isConnected && (
        <div className="px-4 py-2.5 rounded-lg bg-surface-100 text-surface-500 text-sm font-medium">
          Gateway not connected. Connect it in Settings to see live readings.
        </div>
      )}
      {trReadState?.errorMessage && isByteCountMismatch && (
        <div className="px-4 py-2.5 rounded-lg bg-status-critical-soft text-status-critical text-sm font-medium">
          Device returned a different amount of data than requested — the register count in Settings for{' '}
          {transformer.name} likely doesn&apos;t match this device. Readings below are unavailable until fixed.
        </div>
      )}
      {trReadState?.errorMessage && !isByteCountMismatch && (
        <div className="px-4 py-2.5 rounded-lg bg-status-critical-soft text-status-critical text-sm font-medium">
          {trReadState.errorMessage}
        </div>
      )}

      {/* Temperatures */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ReadingTile
          label="OTI Temperature"
          value={readings.otiTemperature}
          unit="°C"
          unavailable={hasReadError}
          showFill
          showTrend
        />
        <ReadingTile
          label="OTI Max"
          value={readings.otiTemperatureMax}
          unit="°C"
          unavailable={hasReadError}
          showFill
        />
        <ReadingTile
          label="WTI Temperature"
          value={readings.wtiTemperature}
          unit="°C"
          unavailable={hasReadError}
          showFill
          showTrend
        />
        <ReadingTile
          label="WTI Max"
          value={readings.wtiTemperatureMax}
          unit="°C"
          unavailable={hasReadError}
          showFill
        />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Mechanical state */}
        <section className="bg-white rounded-lg border border-surface-200 px-4 py-1">
          <StatValue
            label="MOG"
            value={readings.mog === null ? '—' : readings.mog === 0 ? 'Closed' : 'Open'}
            unavailable={hasReadError}
          />
          <StatValue label="Operation Mode" value={readings.operationMode ?? '—'} unavailable={hasReadError} />
          <StatValue label="Tap Position" value={readings.tapPosition ?? '—'} unavailable={hasReadError} />
          <StatValue label="Tap Count" value={readings.tapCount ?? '—'} unavailable={hasReadError} />
        </section>

        {/* Electrical */}
        <section className="bg-white rounded-lg border border-surface-200 px-4 py-1">
          <StatValue
            label="PT Voltage"
            value={readings.ptVoltage === null ? '—' : `${readings.ptVoltage} V`}
            unavailable={hasReadError}
          />
          <StatValue
            label="Actual PT Voltage"
            value={readings.actualPtVoltage === null ? '—' : `${readings.actualPtVoltage} V`}
            unavailable={hasReadError}
          />
        </section>
      </div>

      {/* AVR controls */}
      <section className="bg-white rounded-lg border border-surface-200 p-4 space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-500">AVR Mode</p>
        <div className="flex flex-wrap gap-2">
          <ActionButton onClick={NOT_IMPLEMENTED}>Manual</ActionButton>
          <ActionButton onClick={NOT_IMPLEMENTED}>Tap Lower</ActionButton>
          <ActionButton onClick={NOT_IMPLEMENTED}>Tap Raise</ActionButton>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <ActionButton tone="critical" onClick={NOT_IMPLEMENTED}>
            Lower Relay On
          </ActionButton>
          <ActionButton onClick={NOT_IMPLEMENTED}>Control Fail Reset</ActionButton>
          <ActionButton tone="critical" onClick={NOT_IMPLEMENTED}>
            Raise Relay On
          </ActionButton>
        </div>
      </section>

      {/* Status - TODO: map to real breaker/fault registers once the address map is known */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatusChip label="LV Circuit Breaker" active={null} />
        <StatusChip label="HV Circuit Breaker" active={null} />
        <StatusChip label="PT Fail" active={null} />
        <StatusChip label="OLTC Local" active={null} />
      </section>
    </div>
  );
};

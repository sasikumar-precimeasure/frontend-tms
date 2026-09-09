import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import type { Transformer } from '../../../domain/entities/ConnectionSettings';
import { mapRegistersToReadings } from '../../../domain/entities/TransformerRegisterMap';
import { readTransformerRegistersAsync } from '../slice';

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
}: {
  label: string;
  value: number | null;
  unit?: string;
  unavailable?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-1 px-4 py-3 bg-white rounded-lg border ${unavailable ? 'border-status-critical/30' : 'border-surface-200'}`}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider text-surface-500">{label}</span>
      <span
        className={`font-mono tabular-nums text-2xl font-semibold ${unavailable ? 'text-status-critical/60' : 'text-surface-900'}`}
      >
        {value === null ? (unavailable ? 'N/A' : '—') : value}
        {value !== null && unit && <span className="text-base font-medium text-surface-400 ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}

function StatValue({ label, value, unavailable }: { label: string; value: ReactNode; unavailable?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-surface-100 last:border-b-0">
      <span className="text-sm text-surface-600">{label}</span>
      <span
        className={`font-mono tabular-nums text-sm font-semibold ${unavailable ? 'text-status-critical/60' : 'text-surface-900'}`}
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
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">
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
        <ReadingTile label="OTI Temperature" value={readings.otiTemperature} unit="°C" unavailable={hasReadError} />
        <ReadingTile label="OTI Max" value={readings.otiTemperatureMax} unit="°C" unavailable={hasReadError} />
        <ReadingTile label="WTI Temperature" value={readings.wtiTemperature} unit="°C" unavailable={hasReadError} />
        <ReadingTile label="WTI Max" value={readings.wtiTemperatureMax} unit="°C" unavailable={hasReadError} />
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

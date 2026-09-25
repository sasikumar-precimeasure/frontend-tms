import type { SubDevice } from '../../../domain/entities/ConnectionSettings';
import type { DashboardReadings, TransformerRegisterConfig } from '../../../domain/entities/TransformerRegisterMap';
import { AnnunciationPanel } from './AnnunciationPanel';

interface DevicePanelSettingsDrawerProps {
  trId: string;
  clientId: number;
  device: SubDevice;
  readings: DashboardReadings;
  unavailable?: boolean;
  onClose: () => void;
}

// Right-side slide-in drawer for per-device settings/tools, opened from the
// gear icon on DevicePanel. Currently holds one section (Annunciation) but
// is structured so more sections can be added later without reshaping this
// component.
export function DevicePanelSettingsDrawer({
  trId,
  clientId,
  device,
  readings,
  unavailable,
  onClose,
}: DevicePanelSettingsDrawerProps) {
  // This drawer is only rendered from DevicePanel's IRTCC branch (2243 has
  // no annunciation section), so registerConfig is always
  // TransformerRegisterConfig at runtime here - cast since SubDevice's
  // deviceType/registerConfig aren't a true TS discriminated union.
  const irtccConfig = device.registerConfig as TransformerRegisterConfig;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-md h-full bg-surface-0 shadow-xl flex flex-col animate-panel-enter">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200">
          <div>
            <p className="text-sm font-semibold text-surface-900">Device Settings</p>
            <p className="text-xs text-surface-500 mt-0.5">{device.name}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-full text-surface-500 hover:bg-surface-100 hover:text-surface-700 transition"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-500 mb-3">Annunciation</p>
          <AnnunciationPanel
            trId={trId}
            deviceId={device.id}
            deviceName={device.name}
            clientId={clientId}
            slaveId={device.slaveId}
            startAddress={irtccConfig.startAddress}
            offsets={irtccConfig.offsets}
            active={readings.annunciation}
            acknowledged={readings.annunciationAck}
            ackWords={readings.annAckWords}
            hooterActive={readings.hooterActive}
            muteVisible={readings.muteVisible}
            unavailable={unavailable}
          />
        </div>
      </div>
    </div>
  );
}

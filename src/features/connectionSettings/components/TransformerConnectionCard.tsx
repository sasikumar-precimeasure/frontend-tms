import { useAppDispatch } from '../../../app/store/hooks';
import type { Transformer } from '../../../domain/entities/ConnectionSettings';
import {
  connectTransformerAsync,
  disconnectTransformerAsync,
  updateTransformerConnection,
  clearTransformerError,
  addSubDevice,
  removeSubDevice,
  updateSubDeviceField,
  updateSubDeviceSlaveId,
  toggleSubDeviceEnabled,
} from '../slice';

const STATUS_DOT: Record<string, string> = {
  disconnected: 'bg-surface-300',
  connecting: 'bg-status-warn text-status-warn animate-pulse status-glow',
  connected: 'bg-status-good text-status-good animate-breathe status-glow',
  error: 'bg-status-critical text-status-critical status-glow',
};

interface TransformerConnectionCardProps {
  transformer: Transformer;
}

export const TransformerConnectionCard = ({ transformer }: TransformerConnectionCardProps) => {
  const dispatch = useAppDispatch();

  const handleConnectToggle = () => {
    if (transformer.isConnected) {
      dispatch(disconnectTransformerAsync({ trId: transformer.id, clientId: transformer.clientId }));
    } else {
      dispatch(
        connectTransformerAsync({
          trId: transformer.id,
          clientId: transformer.clientId,
          ipAddress: transformer.ipAddress,
          port: transformer.port,
        })
      );
    }
  };

  return (
    <div className="bg-surface-0 rounded-lg border border-surface-200 overflow-hidden card-hover">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-surface-50 border-b border-surface-200">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[transformer.status] ?? STATUS_DOT.disconnected}`}
        />

        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-surface-500">IP</label>
          <input
            value={transformer.ipAddress}
            onChange={(e) =>
              dispatch(
                updateTransformerConnection({
                  trId: transformer.id,
                  ipAddress: e.target.value,
                  port: transformer.port,
                })
              )
            }
            disabled={transformer.isConnected}
            placeholder="192.168.1.10"
            className="px-2 py-1 text-sm font-mono border border-surface-300 rounded-md w-36 disabled:bg-surface-100 disabled:text-surface-400"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-surface-500">Port</label>
          <input
            type="number"
            value={transformer.port}
            onChange={(e) =>
              dispatch(
                updateTransformerConnection({
                  trId: transformer.id,
                  ipAddress: transformer.ipAddress,
                  port: Number(e.target.value) || 0,
                })
              )
            }
            disabled={transformer.isConnected}
            className="px-2 py-1 text-sm font-mono border border-surface-300 rounded-md w-20 disabled:bg-surface-100 disabled:text-surface-400"
          />
        </div>

        <button
          onClick={handleConnectToggle}
          disabled={transformer.isConnecting}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition disabled:opacity-50 ${
            transformer.isConnected
              ? 'bg-status-good-soft text-status-good hover:bg-status-good/10'
              : 'bg-primary text-white hover:bg-primary-700'
          }`}
        >
          {transformer.isConnecting ? 'Connecting…' : transformer.isConnected ? 'Connected' : 'Connect'}
        </button>
      </div>

      {transformer.errorMessage && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-status-critical-soft flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-status-critical">{transformer.errorMessage}</p>
          <button
            onClick={() => dispatch(clearTransformerError({ trId: transformer.id }))}
            className="text-status-critical/70 hover:text-status-critical text-xs shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      <div className="px-4 py-3 space-y-1">
        {transformer.subDevices.map((device) => (
          <div key={device.id} className="flex flex-wrap items-center gap-3 py-1.5">
            <input
              type="checkbox"
              checked={device.enabled}
              onChange={() => dispatch(toggleSubDeviceEnabled({ trId: transformer.id, deviceId: device.id }))}
              className="w-4 h-4 accent-primary"
            />
            <input
              value={device.name}
              onChange={(e) =>
                dispatch(
                  updateSubDeviceField({
                    trId: transformer.id,
                    deviceId: device.id,
                    field: 'name',
                    value: e.target.value,
                  })
                )
              }
              className="flex-1 min-w-[180px] px-2 py-1 text-sm text-surface-800 border-b border-transparent hover:border-surface-300 focus:border-primary outline-none bg-transparent"
            />
            <label className="text-xs font-medium text-surface-500">RS 485 &middot; ID</label>
            <input
              type="number"
              value={device.slaveId}
              onChange={(e) =>
                dispatch(
                  updateSubDeviceSlaveId({
                    trId: transformer.id,
                    deviceId: device.id,
                    slaveId: Number(e.target.value) || 0,
                  })
                )
              }
              className="w-16 px-2 py-1 text-sm font-mono border border-surface-300 rounded-md"
            />
            <button
              onClick={() => dispatch(removeSubDevice({ trId: transformer.id, deviceId: device.id }))}
              className="text-xs text-surface-400 hover:text-status-critical"
            >
              ✕
            </button>
          </div>
        ))}

        <button
          onClick={() => dispatch(addSubDevice({ trId: transformer.id }))}
          className="text-xs font-semibold text-primary hover:text-primary-700 mt-1"
        >
          + Add Device
        </button>
      </div>
    </div>
  );
};

import { useAppDispatch } from '../../../app/store/hooks';
import type { Gateway } from '../../../domain/entities/ConnectionSettings';
import {
  connectGatewayAsync,
  disconnectGatewayAsync,
  removeGateway,
  updateGatewayField,
  updateGatewayPort,
  addSubDevice,
  removeSubDevice,
  updateSubDeviceField,
  updateSubDeviceSlaveId,
  toggleSubDeviceEnabled,
  clearGatewayError,
} from '../slice';

const STATUS_DOT: Record<string, string> = {
  disconnected: 'bg-surface-300',
  connecting: 'bg-status-warn animate-pulse',
  connected: 'bg-status-good',
  error: 'bg-status-critical',
};

interface GatewayCardProps {
  gateway: Gateway;
}

export const GatewayCard = ({ gateway }: GatewayCardProps) => {
  const dispatch = useAppDispatch();

  const handleConnectToggle = () => {
    if (gateway.isConnected) {
      dispatch(disconnectGatewayAsync({ gatewayId: gateway.id, clientId: gateway.clientId }));
    } else {
      dispatch(
        connectGatewayAsync({
          gatewayId: gateway.id,
          clientId: gateway.clientId,
          ipAddress: gateway.ipAddress,
          port: gateway.port,
        })
      );
    }
  };

  return (
    <div className="bg-white rounded-lg border border-surface-200 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-surface-50 border-b border-surface-200">
        <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[gateway.status] ?? STATUS_DOT.disconnected}`} />

        <input
          value={gateway.label}
          onChange={(e) =>
            dispatch(updateGatewayField({ gatewayId: gateway.id, field: 'label', value: e.target.value }))
          }
          disabled={gateway.isConnected}
          className="text-sm font-semibold text-surface-800 bg-transparent border-b border-transparent hover:border-surface-300 focus:border-primary outline-none disabled:text-surface-500 w-36"
        />

        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-surface-500">IP</label>
          <input
            value={gateway.ipAddress}
            onChange={(e) =>
              dispatch(updateGatewayField({ gatewayId: gateway.id, field: 'ipAddress', value: e.target.value }))
            }
            disabled={gateway.isConnected}
            placeholder="192.168.1.10"
            className="px-2 py-1 text-sm font-mono border border-surface-300 rounded-md w-36 disabled:bg-surface-100 disabled:text-surface-400"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-surface-500">Port</label>
          <input
            type="number"
            value={gateway.port}
            onChange={(e) =>
              dispatch(updateGatewayPort({ gatewayId: gateway.id, port: Number(e.target.value) || 0 }))
            }
            disabled={gateway.isConnected}
            className="px-2 py-1 text-sm font-mono border border-surface-300 rounded-md w-20 disabled:bg-surface-100 disabled:text-surface-400"
          />
        </div>

        <button
          onClick={handleConnectToggle}
          disabled={gateway.isConnecting}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition disabled:opacity-50 ${
            gateway.isConnected
              ? 'bg-status-good-soft text-status-good hover:bg-status-good/10'
              : 'bg-primary text-white hover:bg-primary-700'
          }`}
        >
          {gateway.isConnecting ? 'Connecting…' : gateway.isConnected ? 'Connected' : 'Connect'}
        </button>

        <button
          onClick={() => dispatch(removeGateway({ gatewayId: gateway.id }))}
          className="ml-auto text-xs text-surface-400 hover:text-status-critical font-medium"
        >
          Remove
        </button>
      </div>

      {gateway.errorMessage && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-status-critical-soft flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-status-critical">{gateway.errorMessage}</p>
          <button
            onClick={() => dispatch(clearGatewayError({ gatewayId: gateway.id }))}
            className="text-status-critical/70 hover:text-status-critical text-xs shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      <div className="px-4 py-3 space-y-1">
        {gateway.subDevices.map((device) => (
          <div key={device.id} className="flex flex-wrap items-center gap-3 py-1.5">
            <input
              type="checkbox"
              checked={device.enabled}
              onChange={() => dispatch(toggleSubDeviceEnabled({ gatewayId: gateway.id, deviceId: device.id }))}
              className="w-4 h-4 accent-primary"
            />
            <input
              value={device.name}
              onChange={(e) =>
                dispatch(
                  updateSubDeviceField({
                    gatewayId: gateway.id,
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
                    gatewayId: gateway.id,
                    deviceId: device.id,
                    slaveId: Number(e.target.value) || 0,
                  })
                )
              }
              className="w-16 px-2 py-1 text-sm font-mono border border-surface-300 rounded-md"
            />
            <button
              onClick={() => dispatch(removeSubDevice({ gatewayId: gateway.id, deviceId: device.id }))}
              className="text-xs text-surface-400 hover:text-status-critical"
            >
              ✕
            </button>
          </div>
        ))}

        <button
          onClick={() => dispatch(addSubDevice({ gatewayId: gateway.id }))}
          className="text-xs font-semibold text-primary hover:text-primary-700 mt-1"
        >
          + Add Device
        </button>
      </div>
    </div>
  );
};

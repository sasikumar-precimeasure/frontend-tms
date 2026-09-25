import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import type { Gateway } from '../../../domain/entities/ConnectionSettings';
import {
  connectGatewayAsync,
  disconnectGatewayAsync,
  updateGatewayConnection,
  clearGatewayError,
  addSubDevice,
  removeSubDevice,
  updateSubDeviceField,
  updateSubDeviceSlaveId,
  toggleSubDeviceEnabled,
  renameGateway,
  removeGateway,
} from '../slice';
import { saveRecipientAsync } from '../../mailSettings/slice';

const STATUS_DOT: Record<string, string> = {
  disconnected: 'bg-surface-300',
  connecting: 'bg-status-warn text-status-warn animate-pulse status-glow',
  connected: 'bg-status-good text-status-good animate-breathe status-glow',
  error: 'bg-status-critical text-status-critical status-glow',
};

interface GatewayConnectionCardProps {
  trId: string;
  gateway: Gateway;
}

// One physical Modbus TCP-to-RTU gateway's card: its own IP/port/connection
// plus the RS-485 sub-devices multiplexed over that one socket. A TR renders
// one of these per gateway (see SettingsPage.tsx).
export const TransformerConnectionCard = ({ trId, gateway }: GatewayConnectionCardProps) => {
  const dispatch = useAppDispatch();
  const recipients = useAppSelector((state) => state.mailSettings.recipients);

  const handleConnectToggle = () => {
    if (gateway.isConnected) {
      dispatch(disconnectGatewayAsync({ trId, gatewayId: gateway.id, clientId: gateway.clientId }));
    } else {
      dispatch(
        connectGatewayAsync({
          trId,
          gatewayId: gateway.id,
          clientId: gateway.clientId,
          ipAddress: gateway.ipAddress,
          port: gateway.port,
        })
      );
    }
  };

  return (
    <div className="bg-surface-0 rounded-lg border border-surface-200 overflow-hidden card-hover">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-surface-50 border-b border-surface-200">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[gateway.status] ?? STATUS_DOT.disconnected}`}
        />

        <input
          value={gateway.name}
          onChange={(e) => dispatch(renameGateway({ trId, gatewayId: gateway.id, name: e.target.value }))}
          className="min-w-[120px] px-2 py-1 text-sm font-semibold text-surface-800 border-b border-transparent hover:border-surface-300 focus:border-primary outline-none bg-transparent"
        />

        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-surface-500">IP</label>
          <input
            value={gateway.ipAddress}
            onChange={(e) =>
              dispatch(
                updateGatewayConnection({
                  trId,
                  gatewayId: gateway.id,
                  ipAddress: e.target.value,
                  port: gateway.port,
                })
              )
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
              dispatch(
                updateGatewayConnection({
                  trId,
                  gatewayId: gateway.id,
                  ipAddress: gateway.ipAddress,
                  port: Number(e.target.value) || 0,
                })
              )
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
          onClick={() => dispatch(removeGateway({ trId, gatewayId: gateway.id }))}
          className="ml-auto text-xs text-surface-400 hover:text-status-critical font-medium"
        >
          Remove gateway
        </button>
      </div>

      {gateway.errorMessage && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-status-critical-soft flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-status-critical">{gateway.errorMessage}</p>
          <button
            onClick={() => dispatch(clearGatewayError({ trId, gatewayId: gateway.id }))}
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
              onChange={() => dispatch(toggleSubDeviceEnabled({ trId, gatewayId: gateway.id, deviceId: device.id }))}
              className="w-4 h-4 accent-primary"
            />
            <input
              value={device.name}
              onChange={(e) =>
                dispatch(
                  updateSubDeviceField({
                    trId,
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
                    trId,
                    gatewayId: gateway.id,
                    deviceId: device.id,
                    slaveId: Number(e.target.value) || 0,
                  })
                )
              }
              className="w-16 px-2 py-1 text-sm font-mono border border-surface-300 rounded-md"
            />
            <span className="px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide rounded-full bg-surface-100 text-surface-500">
              {device.deviceType}
            </span>
            <button
              onClick={() => {
                dispatch(removeSubDevice({ trId, gatewayId: gateway.id, deviceId: device.id }));
                // Backend recipients have no dedicated "remove this device
                // everywhere" endpoint - re-save each affected recipient
                // with the stale id filtered out of their deviceIds so
                // tms-backend's copy doesn't keep referencing a device that
                // no longer exists.
                recipients
                  .filter((recipient) => recipient.deviceIds.includes(device.id))
                  .forEach((recipient) => {
                    dispatch(
                      saveRecipientAsync({
                        id: recipient.id,
                        name: recipient.name,
                        email: recipient.email,
                        enabled: recipient.enabled,
                        deviceIds: recipient.deviceIds.filter((id) => id !== device.id),
                      })
                    );
                  });
              }}
              className="text-xs text-surface-400 hover:text-status-critical"
            >
              ✕
            </button>
          </div>
        ))}

        <div className="flex items-center gap-2 mt-1">
          <button
            onClick={() => dispatch(addSubDevice({ trId, gatewayId: gateway.id, deviceType: 'irtcc' }))}
            className="text-xs font-semibold text-primary hover:text-primary-700"
          >
            + Add IRTCC Device
          </button>
          <span className="text-surface-300">|</span>
          <button
            onClick={() => dispatch(addSubDevice({ trId, gatewayId: gateway.id, deviceType: '2243' }))}
            className="text-xs font-semibold text-primary hover:text-primary-700"
          >
            + Add 2243 Device
          </button>
        </div>
      </div>
    </div>
  );
};

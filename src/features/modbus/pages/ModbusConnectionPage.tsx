import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import { connectModbusAsync, disconnectModbusAsync, clearModbusError, clearModbusLogs } from '../slice';
import { Button } from '../../../shared/components';

const DEFAULT_CLIENT_ID = 1;
const DEFAULT_PORT = 502; // MODBUS_PORT

const STATUS_STYLES: Record<string, string> = {
  disconnected: 'bg-gray-100 text-gray-700',
  connecting: 'bg-amber-100 text-amber-700',
  connected: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
};

const ModbusConnectionPage = () => {
  const dispatch = useAppDispatch();
  const { ipAddress, port, status, isConnected, isConnecting, isDisconnecting, error, logs } = useAppSelector(
    (state) => state.modbus
  );

  const [ip, setIp] = useState(ipAddress || '');
  const [portInput, setPortInput] = useState(String(port || DEFAULT_PORT));
  const [ipError, setIpError] = useState<string | null>(null);

  const handleConnect = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ip || !ipRegex.test(ip)) {
      setIpError('Please enter a valid IPv4 address');
      return;
    }
    setIpError(null);

    await dispatch(
      connectModbusAsync({
        clientId: DEFAULT_CLIENT_ID,
        ipAddress: ip,
        port: Number(portInput) || DEFAULT_PORT,
      })
    );
  };

  const handleDisconnect = () => {
    dispatch(disconnectModbusAsync({ clientId: DEFAULT_CLIENT_ID }));
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="bg-white rounded-xl shadow-lg p-6 sm:p-8">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-xl font-bold text-gray-800">Modbus TCP Connection</h1>
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold capitalize ${STATUS_STYLES[status] ?? STATUS_STYLES.disconnected}`}
            >
              {status}
            </span>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start justify-between">
              <p className="text-red-800 text-xs sm:text-sm font-medium">{error}</p>
              <button onClick={() => dispatch(clearModbusError())} className="text-red-600 hover:text-red-800">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          <form onSubmit={handleConnect} className="space-y-4">
            <div>
              <label htmlFor="ipAddress" className="block text-sm font-medium text-gray-900 mb-1.5">
                IP Address
              </label>
              <input
                id="ipAddress"
                name="ipAddress"
                type="text"
                value={ip}
                disabled={isConnected}
                onChange={(e) => {
                  setIp(e.target.value);
                  setIpError(null);
                }}
                placeholder="192.168.1.10"
                className={`w-full px-3 py-2.5 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition disabled:bg-gray-100 disabled:text-gray-500 ${ipError ? 'border-red-400' : 'border-gray-300'}`}
              />
              {ipError && <p className="text-red-600 text-xs mt-1">{ipError}</p>}
            </div>

            <div>
              <label htmlFor="port" className="block text-sm font-medium text-gray-900 mb-1.5">
                Port
              </label>
              <input
                id="port"
                name="port"
                type="number"
                value={portInput}
                disabled={isConnected}
                onChange={(e) => setPortInput(e.target.value)}
                placeholder={String(DEFAULT_PORT)}
                className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition disabled:bg-gray-100 disabled:text-gray-500"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                type="submit"
                isLoading={isConnecting}
                disabled={isConnected}
                fullWidth
                size="md"
                variant="primary"
              >
                Connect
              </Button>
              <Button
                type="button"
                onClick={handleDisconnect}
                isLoading={isDisconnecting}
                disabled={!isConnected}
                fullWidth
                size="md"
                variant="outline"
              >
                Disconnect
              </Button>
            </div>
          </form>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 sm:p-8 flex flex-col max-h-[80vh]">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <h2 className="text-lg font-bold text-gray-800">Request / Response Log</h2>
            {logs.length > 0 && (
              <button
                onClick={() => dispatch(clearModbusLogs())}
                className="text-xs font-medium text-gray-500 hover:text-gray-700"
              >
                Clear
              </button>
            )}
          </div>

          <div className="space-y-3 overflow-y-auto pr-1">
            {logs.length === 0 && (
              <p className="text-sm text-gray-400">No requests yet. Click Connect or Disconnect to see traffic here.</p>
            )}
            {logs.map((log) => (
              <div key={log.id} className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between bg-gray-50 px-3 py-2 border-b border-gray-200">
                  <span className="text-xs font-mono font-semibold text-gray-700">{log.endpoint}</span>
                  <span className="text-[11px] text-gray-400">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="p-3 space-y-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                      Request
                    </p>
                    <pre className="text-xs font-mono bg-gray-900 text-gray-100 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                      {JSON.stringify(log.request, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                      Response
                    </p>
                    {log.errorMessage ? (
                      <pre className="text-xs font-mono bg-red-950 text-red-200 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                        {log.errorMessage}
                      </pre>
                    ) : log.response ? (
                      <pre className="text-xs font-mono bg-gray-900 text-gray-100 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                        {JSON.stringify(log.response, null, 2)}
                      </pre>
                    ) : (
                      <p className="text-xs text-amber-600 italic">Waiting for response...</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModbusConnectionPage;

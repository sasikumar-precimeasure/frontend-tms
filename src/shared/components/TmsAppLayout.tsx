import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { useAppDispatch, useAppSelector, useAppStore } from '../../app/store/hooks';
import type { RootState } from '../../app/store';
import { logoutAsync } from '../../features/auth/slice';
import { useMenuPermissions } from '../hooks/usePermissions';
import type { PermissionMenu } from '../hooks/usePermissions';
import { connectGatewayAsync } from '../../features/connectionSettings/slice';
import type { TransformerRegisterConfig } from '../../domain/entities/TransformerRegisterMap';
import { mapRegistersToReadings } from '../../domain/entities/TransformerRegisterMap';
import type { Device2243RegisterConfig } from '../../domain/entities/Device2243RegisterMap';
import { map2243RegistersToReadings } from '../../domain/entities/Device2243RegisterMap';
import { pushReadingsBatchAsync } from '../../features/readingsPush/slice';
import type {
  ReadingsPushRequest,
  ReadingsPushTransformerEntry,
} from '../../features/readingsPush/slice';

const READINGS_PUSH_INTERVAL_MS = 60_000;

// Builds one POST /tms/api/readings/batch payload from the current Redux
// state - every enabled device under every gateway, paired with its latest
// decoded reading (if any poll has landed for it yet). Devices with no
// reading yet (e.g. gateway not connected) are still included so the
// backend's topology stays in sync, just with a null reading.
function buildReadingsPushRequest(state: RootState): ReadingsPushRequest {
  const now = new Date().toISOString();
  const transformers: ReadingsPushTransformerEntry[] = state.connectionSettings.transformers.map((tr) => ({
    id: tr.id,
    name: tr.name,
    gateways: tr.gateways.map((gw) => ({
      id: gw.id,
      name: gw.name,
      clientId: gw.clientId,
      ipAddress: gw.ipAddress,
      port: gw.port,
      devices: gw.subDevices
        .filter((device) => device.enabled)
        .map((device) => {
          const readingKey = `${tr.id}:${device.id}`;
          const registers = state.dashboard.readingsByTrId[readingKey]?.registers ?? null;

          if (device.deviceType === '2243') {
            const config = device.registerConfig as Device2243RegisterConfig;
            const readings = map2243RegistersToReadings(registers, config.offsets);
            return {
              id: device.id,
              name: device.name,
              slaveId: device.slaveId,
              deviceType: 'DEVICE_2243' as const,
              enabled: device.enabled,
              device2243Reading: registers ? { ...readings, recordedAt: now } : null,
            };
          }

          const config = device.registerConfig as TransformerRegisterConfig;
          const readings = mapRegistersToReadings(registers, config.offsets);
          return {
            id: device.id,
            name: device.name,
            slaveId: device.slaveId,
            deviceType: 'IRTCC' as const,
            enabled: device.enabled,
            irtccReading: registers ? { ...readings, recordedAt: now } : null,
          };
        }),
    })),
  }));

  return { transformers };
}

// Each nav item's `menus` lists every permission menu that would unlock it -
// Settings bundles three independently-permissioned sections (Connection
// Settings / AVR Settings / Mail Configuration; see SettingsSidebar), so it
// stays visible if the user can read any one of them.
const NAV_ITEMS: { to: string; label: string; menus: PermissionMenu[] }[] = [
  { to: '/dashboard', label: 'Dashboard', menus: ['Dashboard'] },
  { to: '/members', label: 'Members', menus: ['Users', 'Roles'] },
  { to: '/audit-log', label: 'Audit Log', menus: ['Audit Log'] },
  { to: '/settings', label: 'Settings', menus: ['Connection Settings', 'AVR Settings', 'Mail Configuration'] },
];

// App shell: a left side menu (Dashboard / Users / Roles / Audit Log /
// Settings) with the active section's page rendered via the router's <Outlet />.
export const TmsAppLayout = () => {
  const { theme, toggleTheme } = useTheme();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const store = useAppStore();
  const transformers = useAppSelector((state) => state.connectionSettings.transformers);
  const currentUser = useAppSelector((state) => state.auth.user);
  const allowedMenus = useMenuPermissions();
  const visibleNavItems = NAV_ITEMS.filter((item) => item.menus.some((menu) => allowedMenus.has(menu)));

  const handleLogout = async () => {
    await dispatch(logoutAsync());
    navigate('/login', { replace: true });
  };

  // Flatten every TR's gateways into one list - each gateway is its own
  // real TCP connection (its own IP/port/clientId), so auto-connect and
  // auto-reconnect both operate per-gateway, not per-TR.
  const gatewayEntries = transformers.flatMap((tr) => tr.gateways.map((gw) => ({ trId: tr.id, gw })));

  // Auto-reconnect once per app load: the gateway's real TCP socket lives in
  // a separate Node process, so a page reload always starts "disconnected"
  // even though the user was connected before - reattach automatically for
  // every gateway with a saved IP, using the same thunk the manual Connect
  // button already dispatches. A ref (not state) guards this so it fires
  // exactly once regardless of re-renders or route changes, since this
  // layout stays mounted for the whole app session.
  const hasAttemptedReconnect = useRef(false);
  useEffect(() => {
    if (hasAttemptedReconnect.current) return;
    hasAttemptedReconnect.current = true;

    gatewayEntries
      .filter(({ gw }) => gw.ipAddress.trim() !== '')
      .forEach(({ trId, gw }) => {
        dispatch(connectGatewayAsync({ trId, gatewayId: gw.id, clientId: gw.clientId, ipAddress: gw.ipAddress, port: gw.port }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-reconnect on drop, not just on load: a read/write can discover the
  // gateway's underlying TCP socket died mid-session (see ModbusClient.ts -
  // a framing/timeout error tears the connection down since the byte stream
  // can't be resynced), which flips a gateway's isConnected to false without
  // the user touching anything. Poll every few seconds and retry
  // connectGatewayAsync for any gateway that's down but has a saved IP and
  // isn't already mid-connect-attempt - same thunk the manual Connect
  // button uses, so status/error state stays consistent either way.
  const gatewayEntriesRef = useRef(gatewayEntries);
  useEffect(() => {
    gatewayEntriesRef.current = gatewayEntries;
    // gatewayEntries is a fresh array every render (derived via flatMap) -
    // depend on `transformers` itself, the actual underlying reference that
    // changes, rather than exhaustive-deps chasing the derived array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transformers]);

  useEffect(() => {
    const RECONNECT_CHECK_MS = 5000;
    const intervalId = setInterval(() => {
      gatewayEntriesRef.current
        .filter(({ gw }) => gw.ipAddress.trim() !== '' && !gw.isConnected && !gw.isConnecting)
        .forEach(({ trId, gw }) => {
          dispatch(connectGatewayAsync({ trId, gatewayId: gw.id, clientId: gw.clientId, ipAddress: gw.ipAddress, port: gw.port }));
        });
    }, RECONNECT_CHECK_MS);
    return () => clearInterval(intervalId);
  }, [dispatch]);

  // Pushes a snapshot of every device's latest reading to tms-backend every
  // 60s for historical storage/audit/mail-threshold evaluation - separate
  // from (and much slower than) the 1s gateway polling DevicePanel already
  // does for live UI responsiveness. getState() is called fresh inside the
  // interval rather than depending on the store's reading state directly,
  // since that changes every ~1s and would otherwise mean re-creating this
  // interval constantly. Also fires once immediately on mount (readings
  // will be null pre-connect, which the backend already tolerates) so the
  // topology upsert happens right away - Settings > Mail Configuration lets
  // a user save a device's alert thresholds immediately after adding it,
  // and the backend's mail_thresholds table has a foreign key against a
  // device row that must exist first; waiting a full 60s for the first
  // periodic push would otherwise make that save fail.
  useEffect(() => {
    const push = () => {
      const request = buildReadingsPushRequest(store.getState());
      if (request.transformers.length > 0) {
        dispatch(pushReadingsBatchAsync(request));
      }
    };
    push();
    const intervalId = setInterval(push, READINGS_PUSH_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [dispatch, store]);

  return (
    <div className="h-screen flex bg-surface-100">
      {/*
        This nav is deliberately always-dark in both themes (a fixed
        instrument-panel rail), so it uses literal colors rather than the
        surface-* scale - that scale inverts its light/dark roles when the
        page theme flips, which would turn this sidebar white in dark mode.
      */}
      <nav className="w-56 shrink-0 flex flex-col py-5" style={{ backgroundColor: '#0c111c', color: '#a6afc0' }}>
        <div className="px-5 pb-5 mb-2 border-b" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
          <p className="text-base font-semibold text-white tracking-tight">TMS</p>
          <p className="text-[11px]" style={{ color: '#6b7688' }}>
            Temperature Monitoring
          </p>
        </div>
        {visibleNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `mx-3 px-3 py-2 rounded-md text-sm font-medium transition ${
                isActive ? 'bg-primary text-white' : 'hover:bg-white/10 hover:text-white'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}

        <div className="mt-auto px-3 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
          {currentUser && (
            <div className="flex items-center gap-2.5 px-2 pb-2.5">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                style={{ backgroundColor: 'rgba(255,255,255,0.12)' }}
              >
                {(currentUser.fullName || currentUser.userName).slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">{currentUser.fullName || currentUser.userName}</p>
                <p className="text-[11px] truncate" style={{ color: '#6b7688' }}>
                  {currentUser.role?.name ?? 'No role'}
                </p>
              </div>
            </div>
          )}

          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="w-full px-3 py-2 rounded-md text-sm font-medium hover:bg-white/10 hover:text-white transition flex items-center gap-2"
          >
            <span aria-hidden>{theme === 'dark' ? '☀️' : '🌙'}</span>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>

          <button
            onClick={handleLogout}
            className="w-full px-3 py-2 mb-1 rounded-md text-sm font-medium hover:bg-white/10 transition flex items-center gap-2"
            style={{ color: '#f47171' }}
          >
            <svg viewBox="0 0 20 20" width={16} height={16} fill="none" aria-hidden>
              <path d="M7.5 17.5H4.5a1 1 0 01-1-1v-13a1 1 0 011-1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M13 14l4-4-4-4M17 10H7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Logout
          </button>
        </div>
      </nav>

      <div className="flex-1 min-w-0 h-screen overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
};

import { useEffect, useRef } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { useAppDispatch, useAppSelector } from '../../app/store/hooks';
import { connectTransformerAsync } from '../../features/connectionSettings/slice';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/settings', label: 'Settings' },
] as const;

// App shell: a left side menu (Dashboard / Settings) with the active
// section's page rendered via the router's <Outlet />.
export const TmsAppLayout = () => {
  const { theme, toggleTheme } = useTheme();
  const dispatch = useAppDispatch();
  const transformers = useAppSelector((state) => state.connectionSettings.transformers);

  // Auto-reconnect once per app load: the gateway's real TCP socket lives in
  // a separate Node process, so a page reload always starts "disconnected"
  // even though the user was connected before - reattach automatically for
  // every transformer with a saved IP, using the same thunk the manual
  // Connect button already dispatches. A ref (not state) guards this so it
  // fires exactly once regardless of re-renders or route changes, since
  // this layout stays mounted for the whole app session.
  const hasAttemptedReconnect = useRef(false);
  useEffect(() => {
    if (hasAttemptedReconnect.current) return;
    hasAttemptedReconnect.current = true;

    transformers
      .filter((tr) => tr.ipAddress.trim() !== '')
      .forEach((tr) => {
        dispatch(connectTransformerAsync({ trId: tr.id, clientId: tr.clientId, ipAddress: tr.ipAddress, port: tr.port }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-reconnect on drop, not just on load: a read/write can discover the
  // gateway's underlying TCP socket died mid-session (see ModbusClient.ts -
  // a framing/timeout error tears the connection down since the byte stream
  // can't be resynced), which flips a transformer's isConnected to false
  // without the user touching anything. Poll every few seconds and retry
  // connectTransformerAsync for any transformer that's down but has a saved
  // IP and isn't already mid-connect-attempt - same thunk the manual
  // Connect button uses, so status/error state stays consistent either way.
  const transformersRef = useRef(transformers);
  useEffect(() => {
    transformersRef.current = transformers;
  }, [transformers]);

  useEffect(() => {
    const RECONNECT_CHECK_MS = 5000;
    const intervalId = setInterval(() => {
      transformersRef.current
        .filter((tr) => tr.ipAddress.trim() !== '' && !tr.isConnected && !tr.isConnecting)
        .forEach((tr) => {
          dispatch(connectTransformerAsync({ trId: tr.id, clientId: tr.clientId, ipAddress: tr.ipAddress, port: tr.port }));
        });
    }, RECONNECT_CHECK_MS);
    return () => clearInterval(intervalId);
  }, [dispatch]);

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
        {NAV_ITEMS.map((item) => (
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

        <button
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          className="mx-3 mt-auto px-3 py-2 rounded-md text-sm font-medium hover:bg-white/10 hover:text-white transition flex items-center gap-2"
        >
          <span aria-hidden>{theme === 'dark' ? '☀️' : '🌙'}</span>
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
      </nav>

      <div className="flex-1 min-w-0 h-screen overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
};

import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { useAppDispatch, useAppSelector, useAppStore } from '../../app/store/hooks';
import { logoutAsync } from '../../features/auth/slice';
import { useMenuPermissions } from '../hooks/usePermissions';
import type { PermissionMenu } from '../hooks/usePermissions';
import type { TransformerRegisterConfig } from '../../domain/entities/TransformerRegisterMap';
import { ANNUNCIATION_TILES, mapRegistersToReadings } from '../../domain/entities/TransformerRegisterMap';
import { showNotification } from '../../features/notifications/slice';
import { useGatewayService } from '../../features/live/useGatewayService';

const ANNUNCIATION_WATCH_INTERVAL_MS = 1_000;

// Each nav item's `menus` lists every permission menu that would unlock it -
// Settings bundles three independently-permissioned sections (Connection
// Settings / AVR Settings / Mail Configuration; see SettingsSidebar), so it
// stays visible if the user can read any one of them.
const NAV_ITEMS: { to: string; label: string; menus: PermissionMenu[] }[] = [
  { to: '/dashboard', label: 'Dashboard', menus: ['Dashboard'] },
  { to: '/members', label: 'Members', menus: ['Users', 'Roles'] },
  { to: '/audit-log', label: 'Audit Log', menus: ['Audit Log'] },
  { to: '/data-log', label: 'Data Log', menus: ['Data Log'] },
  { to: '/settings', label: 'Settings', menus: ['Connection Settings', 'AVR Settings', 'Mail Configuration'] },
];

// App shell: a left side menu (Dashboard / Users / Roles / Audit Log /
// Settings) with the active section's page rendered via the router's <Outlet />.
export const TmsAppLayout = () => {
  const { theme, toggleTheme } = useTheme();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const store = useAppStore();
  const currentUser = useAppSelector((state) => state.auth.user);
  const allowedMenus = useMenuPermissions();
  const visibleNavItems = NAV_ITEMS.filter((item) => item.menus.some((menu) => allowedMenus.has(menu)));

  const handleLogout = async () => {
    await dispatch(logoutAsync());
    navigate('/login', { replace: true });
  };

  // The gateway service connects to and polls the hardware, and pushes
  // readings to the backend - independent of this tab, so minimizing or
  // closing it doesn't interrupt anything. This keeps Settings in sync with
  // it and refreshes the live values on screen.
  useGatewayService();

  // Notifies on a NEW hardware-driven alarm too, not just an acknowledge
  // click (AnnunciationPanel.tsx's own showNotification call covers the
  // click case, but that component only exists while its device's settings
  // drawer happens to be open on the Dashboard's currently-selected
  // transformer tab - a fault on another transformer, or while the user is
  // on a different page entirely, would never be seen there). This runs
  // here instead, in the always-mounted app shell, at the same 1s cadence
  // DevicePanel's own gateway poll uses (not the 60s readings-push
  // interval), since that's how fast a fresh raw register reading actually
  // lands in the store - polling less often would let a brief alarm
  // transition slip through undetected between checks. getState() is read
  // fresh each tick (not via useSelector) for the same reason
  // buildReadingsPushRequest does: the raw reading state changes every ~1s,
  // and selecting it directly here would re-render this whole layout that
  // often. Previous-tile-state is tracked in a ref, not component state,
  // since it's write-only bookkeeping with no rendering of its own.
  const prevAnnunciationByDeviceRef = useRef<Map<string, (boolean | null)[]>>(new Map());
  useEffect(() => {
    const checkForNewAlarms = () => {
      const state = store.getState();
      for (const tr of state.connectionSettings.transformers) {
        for (const gw of tr.gateways) {
          for (const device of gw.subDevices) {
            if (!device.enabled || device.deviceType === '2243') continue;

            const readingKey = `${tr.id}:${device.id}`;
            const registers = state.dashboard.readingsByTrId[readingKey]?.registers ?? null;
            if (!registers) continue;

            const config = device.registerConfig as TransformerRegisterConfig;
            const { annunciation } = mapRegistersToReadings(registers, config.offsets);
            const prev = prevAnnunciationByDeviceRef.current.get(device.id);
            prevAnnunciationByDeviceRef.current.set(device.id, annunciation ?? []);
            if (!prev || !annunciation) continue;

            annunciation.forEach((isActiveNow, i) => {
              const wasActive = prev[i] ?? false;
              if (!wasActive && isActiveNow) {
                const tile = ANNUNCIATION_TILES[i];
                dispatch(showNotification(`"${tile.label}" alarm on ${device.name}`, tr.id, device.id));
              }
            });
          }
        }
      }
    };
    const intervalId = setInterval(checkForNewAlarms, ANNUNCIATION_WATCH_INTERVAL_MS);
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

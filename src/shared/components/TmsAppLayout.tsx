import { NavLink, Outlet } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/settings', label: 'Settings' },
] as const;

// App shell: a left side menu (Dashboard / Settings) with the active
// section's page rendered via the router's <Outlet />.
export const TmsAppLayout = () => {
  return (
    <div className="h-screen flex bg-surface-100">
      <nav className="w-56 shrink-0 bg-surface-900 text-surface-300 flex flex-col py-5">
        <div className="px-5 pb-5 mb-2 border-b border-surface-700/60">
          <p className="text-base font-semibold text-white tracking-tight">TMS</p>
          <p className="text-[11px] text-surface-400">Temperature Monitoring</p>
        </div>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `mx-3 px-3 py-2 rounded-md text-sm font-medium transition ${
                isActive ? 'bg-primary text-white' : 'text-surface-300 hover:bg-surface-800 hover:text-white'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="flex-1 min-w-0 h-screen overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
};

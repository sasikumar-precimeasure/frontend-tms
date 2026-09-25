import { Navigate } from 'react-router-dom';
import { useMenuPermissions } from '../hooks/usePermissions';
import type { PermissionMenu } from '../hooks/usePermissions';

// Blocks direct URL navigation to a page the user's role can't read - the
// nav links in TmsAppLayout already hide themselves, but a typed-in or
// bookmarked URL bypasses that, and the API calls behind the page would
// just 403 anyway (see PermissionGuard.requireRead on the backend). Redirects
// to /dashboard rather than showing an error page, consistent with the page
// simply not existing for this user. Accepts multiple menus for routes like
// /settings that are satisfied by read access to any one of several menus.
export function RequirePermission({ menu, children }: { menu: PermissionMenu | PermissionMenu[]; children: React.ReactNode }) {
  const allowedMenus = useMenuPermissions();
  const required = Array.isArray(menu) ? menu : [menu];
  const allowed = required.some((m) => allowedMenus.has(m));
  if (!allowed) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

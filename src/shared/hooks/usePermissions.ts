import { useAppSelector } from '../../app/store/hooks';

// Menu names exactly as seeded in tms-backend's V1__init.sql and used
// throughout RoleFormPage's PERMISSION_MENUS - keep in sync by hand.
export type PermissionMenu =
  | 'Dashboard'
  | 'Connection Settings'
  | 'AVR Settings'
  | 'Mail Configuration'
  | 'Users'
  | 'Roles'
  | 'Audit Log';

// A menu is "readable" if the user's role grants read OR write on it (write
// implies the ability to see the screen to write to it) - mirrors the
// backend's PermissionGuard.requireRead exactly, so the UI never shows a nav
// link or screen that every API call behind it would 403 on.
export function useHasMenuPermission(menu: PermissionMenu): boolean {
  return useAppSelector((state) =>
    state.auth.permissions.some((p) => p.menu === menu && (p.read || p.write))
  );
}

export function useMenuPermissions(): Set<PermissionMenu> {
  const permissions = useAppSelector((state) => state.auth.permissions);
  return new Set(
    permissions.filter((p) => p.read || p.write).map((p) => p.menu as PermissionMenu)
  );
}

import { useMenuPermissions } from '../../shared/hooks/usePermissions';
import type { PermissionMenu } from '../../shared/hooks/usePermissions';
import type { SettingsSection } from './components/SettingsSidebar';

// Only the implemented sections carry their own permission menu - the
// disabled placeholders in SettingsSidebar aren't gated since they're not
// reachable anyway.
export const SECTION_MENU: Partial<Record<SettingsSection, PermissionMenu>> = {
  'Connection Settings': 'Connection Settings',
  'AVR Settings': 'AVR Settings',
  'Mail Configuration': 'Mail Configuration',
};

// Which of the three implemented sections this user can actually see, in
// their preferred display order - used to pick SettingsPage's initial
// section instead of hardcoding 'Connection Settings', which a
// Mail-Configuration-only user would never be allowed to land on.
export function useFirstAllowedSettingsSection(): SettingsSection | null {
  const allowedMenus = useMenuPermissions();
  const order: SettingsSection[] = ['Connection Settings', 'AVR Settings', 'Mail Configuration'];
  return order.find((section) => allowedMenus.has(SECTION_MENU[section] as PermissionMenu)) ?? null;
}

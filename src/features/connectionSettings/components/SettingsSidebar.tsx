import { useMenuPermissions } from '../../../shared/hooks/usePermissions';
import { SECTION_MENU } from '../settingsSectionPermissions';

const SETTINGS_SECTIONS = [
  'Connection Settings',
  'Password Settings',
  'COM Settings',
  'AVR Settings',
  'Mail Configuration',
  'Input Settings',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

// Only these sections are implemented; the rest are shown disabled so the
// sidebar matches the reference layout without pretending to navigate anywhere.
// Users and Audit Log moved to the top-level nav (TmsAppLayout) - they're
// app-wide administration, not per-transformer Settings.
const IMPLEMENTED: SettingsSection[] = ['Connection Settings', 'AVR Settings', 'Mail Configuration'];

interface SettingsSidebarProps {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}

export const SettingsSidebar = ({ active, onSelect }: SettingsSidebarProps) => {
  const allowedMenus = useMenuPermissions();

  return (
    <nav className="flex flex-col gap-1">
      {SETTINGS_SECTIONS.map((section) => {
        const menu = SECTION_MENU[section];
        const isImplemented = IMPLEMENTED.includes(section) && (menu === undefined || allowedMenus.has(menu));
        const isActive = active === section;
        return (
          <button
            key={section}
            onClick={() => isImplemented && onSelect(section)}
            disabled={!isImplemented}
            title={isImplemented ? undefined : menu && !allowedMenus.has(menu) ? 'You do not have permission to view this' : 'Not implemented yet'}
            className={`text-left px-3 py-2 text-sm font-medium rounded-md transition ${
              !isImplemented
                ? 'text-surface-300 cursor-not-allowed'
                : isActive
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-surface-600 hover:bg-surface-100 hover:text-surface-900'
            }`}
          >
            {section}
          </button>
        );
      })}
    </nav>
  );
};

export { SETTINGS_SECTIONS };

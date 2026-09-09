const SETTINGS_SECTIONS = [
  'Connection Settings',
  'Password Settings',
  'COM Settings',
  'AVR Settings',
  'Input Settings',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

// Only Connection Settings is implemented; the rest are shown disabled so the
// sidebar matches the reference layout without pretending to navigate anywhere.
const IMPLEMENTED: SettingsSection[] = ['Connection Settings'];

interface SettingsSidebarProps {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}

export const SettingsSidebar = ({ active, onSelect }: SettingsSidebarProps) => {
  return (
    <nav className="flex flex-col gap-1">
      {SETTINGS_SECTIONS.map((section) => {
        const isImplemented = IMPLEMENTED.includes(section);
        const isActive = active === section;
        return (
          <button
            key={section}
            onClick={() => isImplemented && onSelect(section)}
            disabled={!isImplemented}
            title={isImplemented ? undefined : 'Not implemented yet'}
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

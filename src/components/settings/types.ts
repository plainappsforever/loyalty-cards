import type { ThemePreference } from '@/db/settings';

/**
 * What every settings layout shows. The four layouts (A grouped list, B sheet, C tile board, D ruled page) take the
 * same props and render the same rows with the same testIDs, so a Maestro flow never depends on the layout:
 * `settings-screen`, `theme-system|light|dark`, `schedule-notification`, `notification-status`, `open-licenses`.
 */
export type SettingsViewProps = {
  themePreference: ThemePreference;
  onThemeChange: (value: ThemePreference) => void;
  onSendTestNotification: () => void;
  notificationStatus: string | null;
  onOpenLicenses: () => void;
  versionText: string;
  labels: {
    appearance: string;
    notifications: string;
    sendNotification: string;
    licenses: string;
    about: string;
  };
};

export const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

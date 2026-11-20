// The four settings layouts show the same rows with the same testIDs, in light and dark (D24).
import { act, create, type ReactTestInstance } from 'react-test-renderer';

import { SettingsA, SettingsB, SettingsC, SettingsD } from './index';
import type { SettingsViewProps } from './types';

let mockScheme: 'light' | 'dark' = 'light';
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => mockScheme }));

const props: SettingsViewProps = {
  themePreference: 'system',
  onThemeChange: jest.fn(),
  onSendTestNotification: jest.fn(),
  notificationStatus: 'Scheduled',
  onOpenLicenses: jest.fn(),
  versionText: 'Version 1',
  labels: { appearance: 'Appearance', notifications: 'Notifications', sendNotification: 'Send', licenses: 'Licences', about: 'About' },
};

const REQUIRED = [
  'settings-screen',
  'theme-system',
  'theme-light',
  'theme-dark',
  'schedule-notification',
  'notification-status',
  'open-licenses',
];

function ids(root: ReactTestInstance) {
  const found = new Set<string>();
  root.findAll((n) => typeof n.props.testID === 'string').forEach((n) => found.add(n.props.testID));
  return found;
}

describe.each([
  ['A', SettingsA],
  ['B', SettingsB],
  ['C', SettingsC],
  ['D', SettingsD],
] as const)('layout %s', (_name, Layout) => {
  test.each(['light', 'dark'] as const)('%s: has every shared testID and reacts to taps', (scheme) => {
    mockScheme = scheme;
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Layout {...props} />);
    });
    const found = ids(tree.root);
    for (const id of REQUIRED) expect(found).toContain(id);
    const dark = tree.root.find((n) => n.props.testID === 'theme-dark' && typeof n.props.onPress === 'function');
    act(() => dark.props.onPress());
    expect(props.onThemeChange).toHaveBeenCalledWith('dark');
    const lic = tree.root.find((n) => n.props.testID === 'open-licenses' && typeof n.props.onPress === 'function');
    act(() => lic.props.onPress());
    expect(props.onOpenLicenses).toHaveBeenCalled();
  });
});

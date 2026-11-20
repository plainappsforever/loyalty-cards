import { Brand } from '@/constants/theme';

import { SettingsA } from './settings-a';
import { SettingsB } from './settings-b';
import { SettingsC } from './settings-c';
import { SettingsD } from './settings-d';
import type { SettingsViewProps } from './types';

export type { SettingsViewProps } from './types';

/** The settings page in the layout `settingsLayout` of brand.json names (A grouped list, B sheet, C tiles, D ruled). */
export function SettingsLayout(props: SettingsViewProps) {
  switch (Brand.settingsLayout) {
    case 'B':
      return <SettingsB {...props} />;
    case 'C':
      return <SettingsC {...props} />;
    case 'D':
      return <SettingsD {...props} />;
    default:
      return <SettingsA {...props} />;
  }
}

export { SettingsA, SettingsB, SettingsC, SettingsD };

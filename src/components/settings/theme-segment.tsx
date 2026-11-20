import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { THEME_OPTIONS, type SettingsViewProps } from './types';

/** System / Light / Dark control used by layouts A, B and C. Same testIDs everywhere. */
export function ThemeSegment({
  themePreference,
  onThemeChange,
}: Pick<SettingsViewProps, 'themePreference' | 'onThemeChange'>) {
  const theme = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: theme.background, borderColor: theme.border }]}>
      {THEME_OPTIONS.map((option) => {
        const selected = option.value === themePreference;
        return (
          <Pressable
            key={option.value}
            testID={`theme-${option.value}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onThemeChange(option.value)}
            style={[styles.segment, selected && { backgroundColor: theme.tint }]}>
            <ThemedText type={selected ? 'smallBold' : 'small'} themeColor={selected ? 'onTint' : 'text'}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: Radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.one,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: Radius.inner,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

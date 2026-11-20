import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemeSegment } from './theme-segment';
import type { SettingsViewProps } from './types';

/**
 * Layout B, sheet: the page is a tall sheet (grabber, rounded top corners) that fills the screen; big rows, one group
 * per block, Licences and version as small text links at the foot. Drawn in place, no Modal, so the route stays a
 * normal screen and Maestro sees the same tree as in the other layouts. Apps whose home opens it as a real sheet can
 * present this route with `presentation: 'formSheet'`.
 */
export function SettingsB(p: SettingsViewProps) {
  const theme = useTheme();
  return (
    <View testID="settings-screen" style={[styles.backdrop, { backgroundColor: theme.backgroundSelected }]}>
      <View style={[styles.sheet, { backgroundColor: theme.background }]}>
        <View style={[styles.grabber, { backgroundColor: theme.border }]} />
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="subtitle">{p.labels.appearance}</ThemedText>
          <ThemeSegment themePreference={p.themePreference} onThemeChange={p.onThemeChange} />

          <ThemedText type="subtitle" style={styles.group}>
            {p.labels.notifications}
          </ThemedText>
          <Button testID="schedule-notification" label={p.labels.sendNotification} onPress={p.onSendTestNotification} />
          {p.notificationStatus ? (
            <ThemedText testID="notification-status" themeColor="textSecondary">
              {p.notificationStatus}
            </ThemedText>
          ) : null}

          <View style={styles.foot}>
            <Pressable testID="open-licenses" accessibilityRole="link" onPress={p.onOpenLicenses} hitSlop={8}>
              <ThemedText type="linkPrimary">{p.labels.licenses}</ThemedText>
            </Pressable>
            <ThemedText type="small" themeColor="textSecondary">
              {p.versionText}
            </ThemedText>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, paddingTop: Spacing.three },
  sheet: {
    flex: 1,
    borderTopLeftRadius: Math.max(Radius.card, 20),
    borderTopRightRadius: Math.max(Radius.card, 20),
    overflow: 'hidden',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    marginTop: Spacing.two,
  },
  content: { padding: Spacing.four, gap: Spacing.three },
  group: { marginTop: Spacing.three },
  foot: { marginTop: Spacing.five, gap: Spacing.two, alignItems: 'flex-start' },
});

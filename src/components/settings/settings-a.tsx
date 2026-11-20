import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemeSegment } from './theme-segment';
import type { SettingsViewProps } from './types';

/** Layout A, grouped list: small section heads, one card per section, Licences and About in the last section. */
export function SettingsA(p: SettingsViewProps) {
  const theme = useTheme();
  return (
    <ScrollView
      testID="settings-screen"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic">
      <ThemedText type="smallBold" themeColor="textSecondary">
        {p.labels.appearance.toUpperCase()}
      </ThemedText>
      <Card style={styles.card}>
        <ThemeSegment themePreference={p.themePreference} onThemeChange={p.onThemeChange} />
      </Card>

      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.head}>
        {p.labels.notifications.toUpperCase()}
      </ThemedText>
      <Card style={styles.card}>
        <Button testID="schedule-notification" label={p.labels.sendNotification} onPress={p.onSendTestNotification} />
        {p.notificationStatus ? (
          <ThemedText testID="notification-status" themeColor="textSecondary">
            {p.notificationStatus}
          </ThemedText>
        ) : null}
      </Card>

      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.head}>
        {p.labels.about.toUpperCase()}
      </ThemedText>
      <Card>
        <Pressable
          testID="open-licenses"
          accessibilityRole="button"
          onPress={p.onOpenLicenses}
          style={styles.row}>
          <ThemedText>{p.labels.licenses}</ThemedText>
          <ThemedText themeColor="textSecondary">{'›'}</ThemedText>
        </Pressable>
        <View style={[styles.rule, { backgroundColor: theme.border }]} />
        <View style={styles.row}>
          <ThemedText themeColor="textSecondary">{p.versionText}</ThemedText>
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.two },
  head: { marginTop: Spacing.three },
  card: { padding: Spacing.two, gap: Spacing.two },
  row: {
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rule: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three },
});

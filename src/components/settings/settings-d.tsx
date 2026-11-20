import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { THEME_OPTIONS, type SettingsViewProps } from './types';

/** Layout D, ruled page: small-caps heads, label left, value right, dotted leader between; no icons, no chevrons. */
function Leader() {
  const theme = useTheme();
  return <View style={[styles.leader, { borderColor: theme.border }]} />;
}

export function SettingsD(p: SettingsViewProps) {
  const theme = useTheme();
  return (
    <ScrollView
      testID="settings-screen"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic">
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.head}>
        {p.labels.appearance.toUpperCase()}
      </ThemedText>
      <View style={styles.line}>
        <ThemedText>{p.labels.appearance}</ThemedText>
        <Leader />
        <View style={styles.options}>
          {THEME_OPTIONS.map((option) => {
            const selected = option.value === p.themePreference;
            return (
              <Pressable
                key={option.value}
                testID={`theme-${option.value}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                hitSlop={6}
                onPress={() => p.onThemeChange(option.value)}>
                <ThemedText
                  type={selected ? 'smallBold' : 'small'}
                  themeColor={selected ? 'tintText' : 'textSecondary'}
                  style={selected && styles.selected}>
                  {option.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.head}>
        {p.labels.notifications.toUpperCase()}
      </ThemedText>
      <Pressable testID="schedule-notification" accessibilityRole="button" onPress={p.onSendTestNotification} style={styles.line}>
        <ThemedText>{p.labels.sendNotification}</ThemedText>
        <Leader />
        <ThemedText type="linkPrimary">Send</ThemedText>
      </Pressable>
      {p.notificationStatus ? (
        <ThemedText testID="notification-status" type="small" themeColor="textSecondary">
          {p.notificationStatus}
        </ThemedText>
      ) : null}

      <View style={styles.foot}>
        <Pressable testID="open-licenses" accessibilityRole="link" onPress={p.onOpenLicenses} hitSlop={8}>
          <ThemedText type="small" themeColor="tintText">
            {p.labels.licenses}
          </ThemedText>
        </Pressable>
        <ThemedText type="small" themeColor="textSecondary">
          {p.versionText}
        </ThemedText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.two },
  head: { marginTop: Spacing.four, letterSpacing: 1.2 },
  line: { flexDirection: 'row', alignItems: 'flex-end', minHeight: 44, paddingBottom: Spacing.one, gap: Spacing.two },
  leader: { flex: 1, borderBottomWidth: 1, borderStyle: 'dotted', marginBottom: 6 },
  options: { flexDirection: 'row', gap: Spacing.three },
  selected: { textDecorationLine: 'underline' },
  foot: { marginTop: Spacing.five, gap: Spacing.one },
});

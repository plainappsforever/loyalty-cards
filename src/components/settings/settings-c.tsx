import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemeSegment } from './theme-segment';
import { THEME_OPTIONS, type SettingsViewProps } from './types';

/**
 * Layout C, tile board: two columns of tiles, one per topic, each printing its current value. The controls live on the
 * tile itself (no second page), so every testID is on screen at once like in the other layouts. Wide tiles carry the
 * controls, square tiles are single taps. The glyph is a letter in the app's title font; an app with an icon motif
 * swaps `Glyph` for its own drawing.
 */
function Glyph({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.glyph, { backgroundColor: theme.tint }]}>
      <ThemedText type="smallBold" themeColor="onTint">
        {children}
      </ThemedText>
    </View>
  );
}

export function SettingsC(p: SettingsViewProps) {
  const theme = useTheme();
  const themeLabel = THEME_OPTIONS.find((o) => o.value === p.themePreference)?.label ?? '';
  return (
    <ScrollView
      testID="settings-screen"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic">
      <Card style={[styles.tile, styles.wide]}>
        <View style={styles.tileHead}>
          <Glyph>L</Glyph>
          <View>
            <ThemedText type="smallBold">{p.labels.appearance}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {themeLabel}
            </ThemedText>
          </View>
        </View>
        <ThemeSegment themePreference={p.themePreference} onThemeChange={p.onThemeChange} />
      </Card>

      <Card style={[styles.tile, styles.wide]}>
        <View style={styles.tileHead}>
          <Glyph>R</Glyph>
          <ThemedText type="smallBold">{p.labels.notifications}</ThemedText>
        </View>
        <Button testID="schedule-notification" label={p.labels.sendNotification} onPress={p.onSendTestNotification} />
        {p.notificationStatus ? (
          <ThemedText testID="notification-status" type="small" themeColor="textSecondary">
            {p.notificationStatus}
          </ThemedText>
        ) : null}
      </Card>

      <Pressable testID="open-licenses" accessibilityRole="button" onPress={p.onOpenLicenses} style={styles.half}>
        <Card style={[styles.tile, styles.square]}>
          <Glyph>O</Glyph>
          <ThemedText type="smallBold">{p.labels.licenses}</ThemedText>
        </Card>
      </Pressable>
      <View style={styles.half}>
        <Card style={[styles.tile, styles.square]}>
          <Glyph>i</Glyph>
          <ThemedText type="smallBold">{p.labels.about}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {p.versionText}
          </ThemedText>
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three, flexDirection: 'row', flexWrap: 'wrap' },
  tile: { padding: Spacing.three, gap: Spacing.two },
  wide: { width: '100%' },
  half: { width: '47.5%', flexGrow: 1 },
  square: { aspectRatio: 1, justifyContent: 'space-between' },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  glyph: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});

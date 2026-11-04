// "+" on the Cards screen (SPEC §7.1): the four ways to add a card. No prompt here; the camera is asked for only when
// Scan opens (A8). Repurposed from the template's "New item" screen (P6, card-scanner D26: repurposed, not deleted).
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { Spacing } from '@/constants/theme';
import { useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';

export default function AddCardScreen() {
  const router = useRouter();
  const theme = useTheme();
  const t = useT();
  // the chooser makes way for the chosen screen (Back then returns to the Cards list)
  const go = (href: '/add/scan' | '/card/new/edit' | '/add/photo' | '/data') => router.replace(href);
  return (
    <ScrollView testID="add-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <Button testID="add-scan" label={t('add.scan')} onPress={() => go('/add/scan')} />
      <Button testID="add-type" label={t('add.type')} variant="secondary" onPress={() => go('/card/new/edit')} />
      <Button testID="add-photo" label={t('add.photo')} variant="secondary" onPress={() => go('/add/photo')} />
      <Button testID="add-import" label={t('add.import')} variant="secondary" onPress={() => go('/data')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.four, gap: Spacing.three },
});

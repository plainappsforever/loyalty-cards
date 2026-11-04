import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useColorScheme } from 'react-native';

import { DatabaseProvider } from '@/db/provider';
import { migrate } from '@/db/migrations';
import { withWrite } from '@/db/tx';
import { getSettings, getThemePreference } from '@/db/settings';
import { applyLanguagePreference } from '@/i18n';
import { useT } from '@/hooks/use-t';
import { excludeAppDataFromBackup, runStartupTasks } from '@/lib/services';
import { applyThemePreference } from '@/lib/theme-preference';
import { startWidgets } from '@/lib/widgets';

async function initDatabase(db: SQLiteDatabase) {
  // D12 / D49: iOS backups skip the database, card photos and widget PNGs; every launch, never blocks
  void excludeAppDataFromBackup();
  // ON DELETE CASCADE for card_categories (SPEC §4.2); a pragma, so outside any transaction but inside the write queue.
  await withWrite(db, (tx) => tx.execAsync('PRAGMA foreign_keys = ON;'));
  await migrate(db);
  applyThemePreference(await getThemePreference(db));
  // the UI language chosen in Settings (SPEC §11); 'system' follows the device
  applyLanguagePreference((await getSettings(db)).language);
  // before any screen renders, so before any capture can start (review R7): sweep, purge, temp folder
  await runStartupTasks(db);
  // widgets + app shortcuts: pushed now and whenever the app goes to the background (SPEC §6.4)
  startWidgets(db);
}

export default function RootLayout() {
  return (
    <DatabaseProvider onInit={initDatabase}>
      <Navigator />
    </DatabaseProvider>
  );
}

function Navigator() {
  const scheme = useColorScheme();
  const t = useT();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="index" options={{ title: t('cards.title') }} />
        <Stack.Screen name="new" options={{ title: t('add.title'), presentation: 'modal' }} />
        <Stack.Screen name="card/[id]/index" options={{ title: '' }} />
        <Stack.Screen name="card/[id]/edit" options={{ title: t('edit.titleEdit') }} />
        <Stack.Screen name="card/[id]/share" options={{ title: t('share.title') }} />
        <Stack.Screen name="add/scan" options={{ title: t('scan.title') }} />
        <Stack.Screen name="add/photo" options={{ title: t('photo.title') }} />
        <Stack.Screen name="receive" options={{ title: t('receive.title') }} />
        <Stack.Screen name="categories" options={{ title: t('categories.title') }} />
        <Stack.Screen name="data" options={{ title: t('data.title') }} />
        <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
      </Stack>
    </ThemeProvider>
  );
}

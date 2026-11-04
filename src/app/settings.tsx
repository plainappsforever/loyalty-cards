// Settings (SPEC §7.10, ≤ 10 items per §15): at the till (brightness boost, keep awake), order of the list, language
// (device + 15), country for store suggestions, appearance, your cards (categories, import/export), widgets (iOS: how to
// add; Android: pin), About (§2 text, what we do not do, privacy policy, licences D19, version). Development builds add
// one diagnostics line: the iOS backup-exclusion flag read back from the database folder (D12/D49).
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { defaultDatabaseDirectory } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useSQLiteContext } from '@/db/provider';
import { getSettings, getThemePreference, setThemePreference, SORT_MODES, updateSetting, type SortMode, type ThemePreference } from '@/db/settings';
import { CHAINS, countryCode } from '@/engine/chains';
import { applyLanguagePreference, deviceRegion, LANGUAGE_NAMES, LANGUAGE_PREFERENCES, type LanguagePreference } from '@/i18n';
import { useT } from '@/hooks/use-t';
import { testToolsEnabled } from '@/lib/variant';
import { useTheme } from '@/hooks/use-theme';
import { toFilePath } from '@/lib/backup-exclusion';
import { backupExclusion, isExcludedFromBackup } from '@/lib/services';
import { applyThemePreference } from '@/lib/theme-preference';
import { requestPinWidget } from '@/lib/widgets';

const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];
/** Countries that have chains in the suggestion list (engine/chains.ts), alphabetical. */
const COUNTRIES: readonly string[] = [...new Set(CHAINS.flatMap((c) => c.countries.map((cc) => countryCode(cc) ?? '')).filter(Boolean))].sort();
const PRIVACY_URL = 'https://plainapps.dfdsfdsfsdf.workers.dev/apps/loyalty-cards/privacy';
const DEV = testToolsEnabled();

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const [themePreference, setThemeState] = useState<ThemePreference>('system');
  const [brightness, setBrightness] = useState(true);
  const [keepAwake, setKeepAwake] = useState(true);
  const [sort, setSort] = useState<SortMode>('manual');
  const [language, setLanguagePref] = useState<LanguagePreference>('system');
  const [country, setCountry] = useState('');
  const [pinStatus, setPinStatus] = useState<string | null>(null);
  const [backupLine, setBackupLine] = useState<string | null>(null);

  useEffect(() => {
    void getThemePreference(db).then(setThemeState);
    void getSettings(db).then((s) => {
      setBrightness(s.brightnessBoost);
      setKeepAwake(s.keepAwake);
      setSort(s.sort);
      setLanguagePref(s.language);
      setCountry(s.defaultCountry);
    });
  }, [db]);

  // development only: the flag on Documents/SQLite read back through a fresh URL (iOS); Android has rule files instead
  useEffect(() => {
    if (!DEV) return;
    const path = toFilePath(defaultDatabaseDirectory);
    if (!path) return;
    void isExcludedFromBackup(path).then((flag) => {
      const results = backupExclusion.map((r) => r.status).join(',');
      setBackupLine(`backup: SQLite isExcluded=${flag === null ? 'n/a (Android: rule files)' : String(flag)} · launch: ${results || 'pending'}`);
    });
  }, []);

  async function chooseTheme(value: ThemePreference) {
    setThemeState(value);
    applyThemePreference(value);
    await setThemePreference(db, value);
  }

  async function chooseLanguage(value: LanguagePreference) {
    setLanguagePref(value);
    await updateSetting(db, 'language', value);
    applyLanguagePreference(value);
  }

  function pin(kind: 'grid' | 'barcode') {
    const result = requestPinWidget(kind);
    if (result) setPinStatus(t(`settings.widgets.${result}`));
  }

  const region = deviceRegion();

  return (
    <ScrollView
      testID="settings-screen"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic">
      <ThemedText type="smallBold">{t('settings.till')}</ThemedText>
      <View style={styles.switchRow}>
        <Switch
          testID="settings-brightness"
          value={brightness}
          onValueChange={(v) => {
            setBrightness(v);
            void updateSetting(db, 'brightnessBoost', v);
          }}
        />
        <ThemedText style={styles.flex}>{t('settings.brightness')}</ThemedText>
      </View>
      <View style={styles.switchRow}>
        <Switch
          testID="settings-keep-awake"
          value={keepAwake}
          onValueChange={(v) => {
            setKeepAwake(v);
            void updateSetting(db, 'keepAwake', v);
          }}
        />
        <ThemedText style={styles.flex}>{t('settings.keepAwake')}</ThemedText>
      </View>

      <ThemedText type="smallBold" style={styles.section}>
        {t('settings.sort')}
      </ThemedText>
      <View style={styles.chips}>
        {SORT_MODES.map((mode) => (
          <Chip
            key={mode}
            testID={`settings-sort-${mode}`}
            label={t(`sort.${mode}`)}
            selected={sort === mode}
            onPress={() => {
              setSort(mode);
              void updateSetting(db, 'sort', mode);
            }}
          />
        ))}
      </View>

      <ThemedText type="smallBold" style={styles.section}>
        {t('settings.language')}
      </ThemedText>
      <View style={styles.chips}>
        {LANGUAGE_PREFERENCES.map((pref) => (
          <Chip
            key={pref}
            testID={`language-${pref}`}
            label={pref === 'system' ? t('settings.language.system') : LANGUAGE_NAMES[pref]}
            selected={language === pref}
            onPress={() => void chooseLanguage(pref)}
          />
        ))}
      </View>

      <ThemedText type="smallBold" style={styles.section}>
        {t('settings.country')}
      </ThemedText>
      <View style={styles.chips}>
        <Chip
          testID="country-device"
          label={region ? `${t('settings.country.device')} (${region})` : t('settings.country.device')}
          selected={country === ''}
          onPress={() => {
            setCountry('');
            void updateSetting(db, 'defaultCountry', '');
          }}
        />
        {COUNTRIES.map((cc) => (
          <Chip
            key={cc}
            testID={`country-${cc}`}
            label={cc}
            selected={country === cc}
            onPress={() => {
              setCountry(cc);
              void updateSetting(db, 'defaultCountry', cc);
            }}
          />
        ))}
      </View>

      <ThemedText type="smallBold" style={styles.section}>
        {t('settings.appearance')}
      </ThemedText>
      <View style={[styles.segmented, { backgroundColor: theme.backgroundElement }]}>
        {THEMES.map((value) => {
          const selected = value === themePreference;
          return (
            <Pressable
              key={value}
              testID={`theme-${value}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => chooseTheme(value)}
              style={[styles.segment, selected && { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type={selected ? 'smallBold' : 'small'}>{t(`settings.theme.${value}`)}</ThemedText>
            </Pressable>
          );
        })}
      </View>

      <ThemedText type="smallBold" style={styles.section}>
        {t('settings.manage')}
      </ThemedText>
      <Button testID="open-categories" variant="secondary" label={t('settings.categories')} onPress={() => router.push('/categories')} />
      <Button testID="open-data" variant="secondary" label={t('settings.data')} onPress={() => router.push('/data')} />

      <ThemedText type="smallBold" style={styles.section}>
        {t('settings.widgets')}
      </ThemedText>
      {Platform.OS === 'android' ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            {t('settings.widgets.androidHelp')}
          </ThemedText>
          <Button testID="settings-widget-grid" variant="secondary" label={t('settings.widgets.addGrid')} onPress={() => pin('grid')} />
          <Button testID="settings-widget-barcode" variant="secondary" label={t('settings.widgets.addBarcode')} onPress={() => pin('barcode')} />
          {pinStatus ? (
            <ThemedText testID="settings-widget-status" type="small" themeColor="textSecondary">
              {pinStatus}
            </ThemedText>
          ) : null}
        </>
      ) : (
        <ThemedText testID="settings-widget-help" type="small" themeColor="textSecondary">
          {t('settings.widgets.iosHelp')}
        </ThemedText>
      )}

      <ThemedText type="smallBold" style={styles.section}>
        {t('settings.about')}
      </ThemedText>
      <ThemedText testID="settings-about" type="small">
        {t('settings.about.text')}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t('settings.about.notDone')}
      </ThemedText>
      <Button testID="open-privacy" variant="secondary" label={t('settings.about.privacy')} onPress={() => void Linking.openURL(PRIVACY_URL)} />
      <Button testID="open-licenses" variant="secondary" label={t('licenses.open')} onPress={() => router.push('/licenses')} />
      <ThemedText type="small" themeColor="textSecondary">
        {t('settings.version', { version: `${Constants.expoConfig?.version ?? ''} (${String(Constants.expoConfig?.extra?.appVariant)})` })}
      </ThemedText>
      {DEV && backupLine ? (
        <ThemedText testID="settings-backup-debug" type="small" themeColor="textSecondary">
          {backupLine}
        </ThemedText>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
    paddingBottom: Spacing.six,
  },
  section: {
    marginTop: Spacing.four,
  },
  flex: { flex: 1 },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: Spacing.one,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

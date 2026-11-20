// Settings, tile board (layout C, 1.1.0): one tile per topic with a small drawn card glyph and its current value; the
// controls sit on the tiles, so every testID is on screen without a second page. (SPEC §7.10, ≤ 10 items per §15): at the till (brightness boost, keep awake), order of the list, language
// (device + 15), country for store suggestions, appearance, your cards (categories, import/export), widgets (iOS: how to
// add; Android: pin), About (§2 text, what we do not do, privacy policy, licences D19, version). Development builds add
// one diagnostics line: the iOS backup-exclusion flag read back from the database folder (D12/D49).
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { defaultDatabaseDirectory } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { Paper, Radius, Spacing } from '@/constants/theme';
import { useSQLiteContext } from '@/db/provider';
import { getSetting, getSettings, getThemePreference, setThemePreference, SORT_MODES, updateSetting, type SortMode, type ThemePreference } from '@/db/settings';
import { CHAINS, countryCode } from '@/engine/chains';
import { applyLanguagePreference, deviceRegion, LANGUAGE_NAMES, LANGUAGE_PREFERENCES, type LanguagePreference } from '@/i18n';
import { useT } from '@/hooks/use-t';
import { currentVariant, debugReadoutsVisible, STORE_SHOTS_KEY, testToolsEnabled } from '@/lib/variant';
import { useTheme } from '@/hooks/use-theme';
import { toFilePath } from '@/lib/backup-exclusion';
import { backupExclusion, isExcludedFromBackup } from '@/lib/services';
import { maybeAskForReview } from '@/lib/review-prompt';
import { applyThemePreference } from '@/lib/theme-preference';
import { requestPinWidget } from '@/lib/widgets';

const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];
/** Countries that have chains in the suggestion list (engine/chains.ts), alphabetical. */
const COUNTRIES: readonly string[] = [...new Set(CHAINS.flatMap((c) => c.countries.map((cc) => countryCode(cc) ?? '')).filter(Boolean))].sort();
const PRIVACY_URL = 'https://plainapps.dfdsfdsfsdf.workers.dev/apps/loyalty-cards/privacy';
const TEST_BUILD = testToolsEnabled();

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
  // debug read-outs: test builds only, hidden while the store-screenshot switch is set (variant.ts)
  const [DEV, setDev] = useState(false);
  useEffect(() => {
    if (TEST_BUILD) void getSetting(db, STORE_SHOTS_KEY).then((v) => setDev(debugReadoutsVisible(currentVariant(), v)));
  }, [db]);

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
  }, [DEV]);

  // rating prompt (lib/review-prompt.ts): after the fifth till use, once per version, on a screen without a code
  useEffect(() => {
    const timer = setTimeout(() => void maybeAskForReview(db), 1500);
    return () => clearTimeout(timer);
  }, [db]);

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
  const languageName = language === 'system' ? t('settings.language.system') : LANGUAGE_NAMES[language];
  const countryName = country === '' ? (region ? `${t('settings.country.device')} (${region})` : t('settings.country.device')) : country;

  return (
    <ScrollView
      testID="settings-screen"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic">
      <Tile title={t('settings.till')} value={brightness && keepAwake ? t('settings.till.on') : undefined} bars={[2, 5, 2, 3]}>
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
      </Tile>

      <Tile title={t('settings.sort')} value={t(`sort.${sort}`)} bars={[4, 2, 6, 2]}>
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
      </Tile>

      <Tile title={t('settings.language')} value={languageName} bars={[3, 3, 5, 2]}>
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
      </Tile>

      <Tile title={t('settings.country')} value={countryName} bars={[6, 2, 2, 4]}>
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
      </Tile>

      <Tile title={t('settings.appearance')} value={t(`settings.theme.${themePreference}`)} bars={[2, 2, 5, 5]}>
        <View style={[styles.segmented, { backgroundColor: theme.background, borderColor: theme.border }]}>
          {THEMES.map((value) => {
            const selected = value === themePreference;
            return (
              <Pressable
                key={value}
                testID={`theme-${value}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => chooseTheme(value)}
                style={[styles.segment, selected && { backgroundColor: theme.tint }]}>
                <ThemedText type={selected ? 'smallBold' : 'small'} themeColor={selected ? 'onTint' : 'text'}>
                  {t(`settings.theme.${value}`)}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </Tile>

      <View style={styles.row}>
        <SquareTile testID="open-categories" title={t('settings.categories')} bars={[3, 6, 2, 3]} onPress={() => router.push('/categories')} />
        <SquareTile testID="open-data" title={t('settings.data')} bars={[5, 2, 4, 2]} onPress={() => router.push('/data')} />
      </View>

      <Tile title={t('settings.widgets')} bars={[2, 6, 3, 3]}>
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
      </Tile>

      <Tile title={t('settings.about')} bars={[4, 3, 2, 5]}>
        <ThemedText testID="settings-about" type="small">
          {t('settings.about.text')}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t('settings.about.notDone')}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t('settings.version', { version: !TEST_BUILD || DEV ? `${Constants.expoConfig?.version ?? ''} (${String(Constants.expoConfig?.extra?.appVariant)})` : (Constants.expoConfig?.version ?? '') })}
        </ThemedText>
        {DEV && backupLine ? (
          <ThemedText testID="settings-backup-debug" type="small" themeColor="textSecondary">
            {backupLine}
          </ThemedText>
        ) : null}
      </Tile>

      <View style={styles.row}>
        <SquareTile testID="open-privacy" title={t('settings.about.privacy')} bars={[2, 4, 4, 2]} onPress={() => void Linking.openURL(PRIVACY_URL)} />
        <SquareTile testID="open-licenses" title={t('licenses.open')} bars={[5, 3, 2, 2]} onPress={() => router.push('/licenses')} />
      </View>
    </ScrollView>
  );
}

/** The tile glyph: a small card with a colour band and bars, in the icon's motif. `bars` = bar widths. */
function Glyph({ bars }: { bars: readonly number[] }) {
  const theme = useTheme();
  return (
    <View style={[styles.glyph, { backgroundColor: Paper.background, borderColor: theme.border }]}>
      <View style={[styles.glyphBand, { backgroundColor: theme.tint }]} />
      <View style={styles.glyphBars}>
        {bars.map((w, i) => (
          <View key={i} style={{ width: w, height: 8, backgroundColor: Paper.ink }} />
        ))}
      </View>
    </View>
  );
}

function Tile({ title, value, bars, children }: { title: string; value?: string; bars: readonly number[]; children: React.ReactNode }) {
  return (
    <Card style={styles.tile}>
      <View style={styles.tileHead}>
        <Glyph bars={bars} />
        <View style={styles.flex}>
          <ThemedText type="smallBold">{title}</ThemedText>
          {value ? (
            <ThemedText type="small" themeColor="tintText" numberOfLines={1}>
              {value}
            </ThemedText>
          ) : null}
        </View>
      </View>
      {children}
    </Card>
  );
}

function SquareTile({ title, bars, testID, onPress }: { title: string; bars: readonly number[]; testID: string; onPress: () => void }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.half, pressed && { opacity: 0.7 }]}>
      <Card style={styles.square}>
        <Glyph bars={bars} />
        <ThemedText type="smallBold">{title}</ThemedText>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  flex: { flex: 1 },
  tile: { padding: Spacing.three, gap: Spacing.three },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  row: { flexDirection: 'row', gap: Spacing.three },
  half: { flex: 1 },
  square: { aspectRatio: 1.3, padding: Spacing.three, justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  segmented: { flexDirection: 'row', borderRadius: Radius.control, borderWidth: StyleSheet.hairlineWidth, padding: Spacing.one },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  segment: { flex: 1, minHeight: 40, borderRadius: Radius.inner, alignItems: 'center', justifyContent: 'center' },
  glyph: { width: 44, height: 30, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  glyphBand: { height: 8 },
  glyphBars: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
});

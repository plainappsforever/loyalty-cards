// Import / Export (SPEC §7.9, U5, U7). Import: the system document picker (a copy in the cache) → Receive. Export:
// Catima zip (photos converted to PNG natively, D37.6), Tillcard backup zip (JPEG photos), CSV → the file name, size and
// an exact report are shown BEFORE the share sheet (SPEC §2); "Last export" is kept. Nothing leaves without a tap.
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useSQLiteContext } from '@/db/provider';
import { getSettings, updateSetting } from '@/db/settings';
import { useLanguage, useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';
import { buildExport, formatSize, type ExportKind, type ExportResult } from '@/lib/export';
import { exportDeps, shareFile, writeExportFile } from '@/lib/services';

export default function DataScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const t = useT();
  const language = useLanguage();
  const [lastExport, setLastExport] = useState<number | null>(null);
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [ready, setReady] = useState<(ExportResult & { uri: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void getSettings(db).then((s) => setLastExport(s.lastExportAt));
    }, [db])
  );

  async function pick() {
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: ['application/zip', 'application/x-zip-compressed', 'text/csv', 'text/comma-separated-values', 'text/plain', 'application/json', '*/*'] });
    if (r.canceled || !r.assets[0]) return;
    router.push({ pathname: '/receive', params: { uri: r.assets[0].uri } });
  }

  async function build(kind: ExportKind) {
    setBusy(kind);
    setReady(null);
    setError(null);
    try {
      const result = await buildExport(db, kind, exportDeps);
      setReady({ ...result, uri: writeExportFile(result.fileName, result.bytes) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  }

  async function share() {
    if (!ready) return;
    await shareFile(ready.uri, ready.mimeType);
    const now = Date.now();
    await updateSetting(db, 'lastExportAt', now);
    setLastExport(now);
  }

  const dropped = ready?.dropped.map((d) => `${d.name}: ${d.field} ${d.value}`).join('; ') ?? '';
  return (
    <ScrollView testID="data-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <ThemedText type="smallBold">{t('data.import')}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t('data.importHint')}
      </ThemedText>
      <Button testID="data-import" label={t('data.import')} onPress={pick} />

      <ThemedText type="smallBold" style={styles.section}>
        {t('data.export')}
      </ThemedText>
      <Button testID="export-catima" variant="secondary" label={t('data.exportCatima')} disabled={busy !== null} onPress={() => build('catima')} />
      <Button testID="export-backup" variant="secondary" label={t('data.exportBackup')} disabled={busy !== null} onPress={() => build('backup')} />
      <Button testID="export-csv" variant="secondary" label={t('data.exportCsv')} disabled={busy !== null} onPress={() => build('csv')} />
      {busy ? <ThemedText>{t('data.building')}</ThemedText> : null}
      {error ? (
        <ThemedText testID="export-error" themeColor="danger">
          {error}
        </ThemedText>
      ) : null}
      {ready ? (
        <View style={[styles.ready, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText testID="export-result" type="smallBold">
            {t('data.ready', { name: ready.fileName, size: formatSize(ready.bytes.length), n: ready.exported })}
          </ThemedText>
          <ThemedText testID="export-photos" type="small">
            {t('data.photos', { n: ready.photos })}
          </ThemedText>
          {ready.omitted.length ? <ThemedText testID="export-omitted">{t('data.omitted', { names: ready.omitted.map((o) => o.name).join(', ') })}</ThemedText> : null}
          {dropped ? <ThemedText testID="export-dropped">{t('data.dropped', { items: dropped })}</ThemedText> : null}
          {ready.photoFailures ? <ThemedText testID="export-photo-failed">{t('data.photoFailed', { n: ready.photoFailures })}</ThemedText> : null}
          <Button testID="export-share" label={t('data.share')} onPress={share} />
        </View>
      ) : null}
      <ThemedText testID="data-last-export" type="small" themeColor="textSecondary" style={styles.section}>
        {lastExport ? t('data.lastExport', { date: new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lastExport)) }) : t('data.never')}
      </ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.two },
  section: { marginTop: Spacing.four },
  ready: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
});

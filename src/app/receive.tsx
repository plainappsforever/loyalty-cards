// Receive (SPEC §7.8, U5/U6, A13/A14): opened by a file (open-with, +native-intent → `?uri=`), by Import (`?uri=` of the
// picked copy) or by a scanned `LC1:` payload / Catima link (`?text=`). Preview: what it is, how many cards, the first
// names; when some already exist, the duplicate rule is asked ONCE (skip = default, keep both). Add → exact summary.
// Nothing is written before Add (L26: import never overwrites; a Skip leaves the wallet untouched).
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useSQLiteContext } from '@/db/provider';
import { FORMATS } from '@/engine/barcode/formats';
import type { DuplicateRule } from '@/engine/import-plan';
import { useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';
import { readBytes } from '@/lib/fs-expo';
import { countDuplicates, importReceived, type ImportSummary } from '@/lib/import';
import { readIncomingFile, readIncomingText, ReceiveError, type Received } from '@/lib/receive';
import { importDeps } from '@/lib/services';

const PREVIEW = 30;

export default function ReceiveScreen() {
  const params = useLocalSearchParams<{ uri?: string; text?: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const t = useT();
  const [received, setReceived] = useState<Received | null>(null);
  const [duplicates, setDuplicates] = useState(0);
  const [rule, setRule] = useState<DuplicateRule>('skip');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        let r: Received | null;
        if (params.text) r = readIncomingText(params.text);
        else if (params.uri) r = readIncomingFile(await readBytes(params.uri));
        else r = null;
        if (!r) throw new ReceiveError('notSupported');
        if (r.cards.length === 0 && r.skipped.length === 0) throw new ReceiveError('noCards');
        const d = await countDuplicates(db, r);
        if (!active) return;
        setReceived(r);
        setDuplicates(d);
      } catch (e) {
        if (!active) return;
        setError(e instanceof ReceiveError ? t(`receive.error.${e.code}`) : t('receive.error.read', { reason: e instanceof Error ? e.message : String(e) }));
      }
    })();
    return () => {
      active = false;
    };
  }, [db, params.uri, params.text, t]);

  async function add() {
    if (!received) return;
    setBusy(true);
    try {
      setSummary(await importReceived(db, importDeps, received, rule));
    } catch (e) {
      setError(t('receive.error.read', { reason: e instanceof Error ? e.message : String(e) }));
    }
    setBusy(false);
  }

  const lines = summary
    ? [
        t('receive.summary.imported', { n: summary.imported }),
        summary.skipped ? t('receive.summary.skipped', { n: summary.skipped }) : '',
        summary.duplicates ? t('receive.summary.duplicates', { n: summary.duplicates }) : '',
        summary.keptDuplicates ? t('receive.summary.kept', { n: summary.keptDuplicates }) : '',
        summary.invalidCodes ? t('receive.summary.invalid', { n: summary.invalidCodes }) : '',
        summary.truncatedNames ? t('receive.summary.truncated', { n: summary.truncatedNames }) : '',
        summary.brokenPhotos ? t('receive.summary.broken', { n: summary.brokenPhotos }) : '',
        summary.photoFailures ? t('receive.summary.photoFailed', { n: summary.photoFailures }) : '',
      ].filter(Boolean)
    : [];

  return (
    <ScrollView testID="receive-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      {error ? (
        <>
          <ThemedText testID="receive-error" themeColor="danger">
            {error}
          </ThemedText>
          <Button testID="receive-done" label={t('receive.done')} onPress={() => router.dismissTo('/')} />
        </>
      ) : !received ? (
        <ThemedText testID="receive-loading">{t('receive.loading')}</ThemedText>
      ) : summary ? (
        <>
          <ThemedText testID="receive-summary" type="smallBold">
            {lines.join(', ')}
          </ThemedText>
          <Button testID="receive-done" label={t('receive.done')} onPress={() => router.dismissTo('/')} />
        </>
      ) : (
        <>
          <ThemedText testID="receive-kind" type="smallBold">
            {t(`receive.kind.${received.kind}`)}
          </ThemedText>
          <ThemedText testID="receive-count">{t('receive.count', { n: received.cards.length })}</ThemedText>
          {duplicates > 0 ? (
            <View style={{ gap: Spacing.two }}>
              <ThemedText testID="receive-duplicates">{t('receive.dupTitle', { n: duplicates })}</ThemedText>
              <View style={styles.row}>
                <Chip testID="dup-skip" label={t('receive.dupSkip')} selected={rule === 'skip'} onPress={() => setRule('skip')} />
                <Chip testID="dup-keep" label={t('receive.dupKeep')} selected={rule === 'keepBoth'} onPress={() => setRule('keepBoth')} />
              </View>
            </View>
          ) : null}
          <Button testID="receive-add" label={busy ? `${t('receive.add')}…` : t('receive.add')} disabled={busy || received.cards.length === 0} onPress={add} />
          <Button testID="receive-skip" variant="secondary" label={t('receive.skip')} disabled={busy} onPress={() => router.dismissTo('/')} />
          {/* decisions first, the preview list below (no scrolling to reach Add) */}
          <View style={[styles.list, { backgroundColor: theme.backgroundElement }]}>
            {received.cards.slice(0, PREVIEW).map((c, i) => (
              <ThemedText key={i} testID={`receive-card-${i}`} type="small" numberOfLines={1}>
                {`${c.name} · ${c.format === 'none' ? t('format.none') : FORMATS[c.format].name}`}
              </ThemedText>
            ))}
            {received.cards.length > PREVIEW ? <ThemedText type="small">{t('receive.more', { n: received.cards.length - PREVIEW })}</ThemedText> : null}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
  list: { borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.one },
  row: { flexDirection: 'row', gap: Spacing.two },
});

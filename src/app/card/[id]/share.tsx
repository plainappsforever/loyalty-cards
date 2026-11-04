// Share (SPEC §7.7, U6): a QR code with the card's `LC1:` payload (§5.4) for another phone running the app ("Let them
// scan this"), Send as file (our backup zip with this card and its photos), Copy Catima link, Copy number. The QR is
// encoded once when the screen opens (≤ 1,200 bytes; not the till path).
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Button } from '@/components/button';
import { CodeView } from '@/components/code-view';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getCard, type Card } from '@/db/cards';
import { useSQLiteContext } from '@/db/provider';
import { buildCatimaShareUrl } from '@/engine/catima/share-url';
import { buildSharePayload } from '@/engine/share-payload';
import { useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';
import { buildCodeCache } from '@/lib/code-cache';
import { buildExport } from '@/lib/export';
import { exportDeps, shareFile, writeExportFile } from '@/lib/services';

export default function ShareScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const theme = useTheme();
  const t = useT();
  const { width } = useWindowDimensions();
  const [card, setCard] = useState<Card | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void getCard(db, id).then(setCard);
  }, [db, id]);

  const payload = useMemo(() => (card ? buildSharePayload(card) : null), [card]);
  const qr = useMemo(() => (payload && !payload.tooLarge ? buildCodeCache(payload.text, 'qr') : null), [payload]);
  const link = useMemo(
    () => (card ? buildCatimaShareUrl({ name: card.name, number: card.number, codeValue: card.codeValue, format: card.format, color: card.color, note: card.note, balance: card.balance, balanceCurrency: card.balanceCurrency, validFrom: card.validFrom, expiry: card.expiry }) : null),
    [card]
  );

  async function copy(what: 'link' | 'number', text: string) {
    await Clipboard.setStringAsync(text);
    setCopied(what);
    // one timer: an earlier copy's timer must not clear the newer "Copied"
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 3000);
  }

  async function sendFile() {
    if (!card) return;
    const r = await buildExport(db, 'backup', exportDeps, Date.now(), [card.id]);
    const name = `tillcard-${card.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'card'}.zip`;
    await shareFile(writeExportFile(name, r.bytes), r.mimeType);
  }

  if (!card || !payload) return <View style={{ flex: 1, backgroundColor: theme.background }} />;
  return (
    <ScrollView testID="share-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      {qr ? (
        <View style={styles.qr}>
          <CodeView testID="share-qr" value={payload.text} format="qr" cache={qr} width={width - Spacing.three * 2} height={width} />
        </View>
      ) : (
        <ThemedText testID="share-too-large" themeColor="danger">
          {t('share.tooLarge')}
        </ThemedText>
      )}
      {qr ? (
        <ThemedText testID="share-hint" style={styles.center}>
          {t('share.hint', { app: t('app.name') })}
        </ThemedText>
      ) : null}
      {payload.noteTruncated ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('share.noteCut')}
        </ThemedText>
      ) : null}
      <Button testID="share-file" label={t('share.file')} onPress={sendFile} />
      {link ? (
        <Button testID="share-catima-link" variant="secondary" label={copied === 'link' ? t('card.copied') : t('share.catimaLink')} onPress={() => copy('link', link)} />
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {t('share.noLink')}
        </ThemedText>
      )}
      <Button testID="share-copy-number" variant="secondary" label={copied === 'number' ? t('card.copied') : t('share.copyNumber')} onPress={() => copy('number', card.number)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
  qr: { alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 12, paddingVertical: Spacing.three },
  center: { textAlign: 'center' },
});

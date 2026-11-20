// Test seed route (development and preview variants, never production; P8a; F5/D54: a PREVIEW build with data asks for a typed word before the wipe): <scheme>://debug/seed?set=empty|ten|two-hundred|five-hundred[&heavy=1][&photo=1]
// P6: every seeded 2D card gets its render-once cache like a saved card (D42); `heavy=1` adds the two slowest S4 codes
// (Aztec 日×500 ≈ 1 s and QR 'aB3$%&()'×125 to encode on Hermes) as the first cards, to time the card screen from cache;
// `photo=1` gives seed-1 a front photo through the native PNG → JPEG path (the Catima export then converts it back to PNG).
// Wipes every card/category (and their photo folders through the sweep), loads the named seed set, prints `seed-done`.
// P1: data only, no UI beyond the status line; every Maestro flow starts here (BUILD_PROMPT rule 4).
import { fixtureFileUri } from '../../dev/fixture-file';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';

import { ThemedText } from '@/components/themed-text';
import { codeOf, createCards, hasWipeableData, updateCard, wipeAllCards, type NewCard } from '@/db/cards';
import { useSQLiteContext } from '@/db/provider';
import { deleteSetting, setSetting } from '@/db/settings';
import { SEED_SETS, seedCards, type SeedSet } from '@/dev/seed';
import { useT } from '@/hooks/use-t';
import { currentVariant, seedNeedsConfirmation, STORE_SHOTS_KEY, testToolsEnabled, wipeConfirmed, WIPE_WORD } from '@/lib/variant';
import { buildCodeCache } from '@/lib/code-cache';
import { replacePhoto } from '@/lib/files';
import { expoFs } from '@/lib/fs-expo';
import { photoToTempJpeg } from '@/lib/services';

const HEAVY: NewCard[] = [
  { id: 'heavy-aztec', name: 'Heavy Aztec', number: '日'.repeat(500), format: 'aztec', color: '#8e44ad' },
  { id: 'heavy-qr', name: 'Heavy QR', number: 'aB3$%&()'.repeat(125), format: 'qr', color: '#2980b9' },
];

export default function SeedScreen() {
  const params = useLocalSearchParams<{ set?: string; heavy?: string; photo?: string; lang?: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const t = useT();
  const [status, setStatus] = useState<string>('');
  const [done, setDone] = useState(false);
  const started = useRef(false);
  const dev = testToolsEnabled();

  const [askWord, setAskWord] = useState(false);
  const [typed, setTyped] = useState('');

  async function seed() {
    const set = (SEED_SETS as readonly string[]).includes(params.set ?? '') ? (params.set as SeedSet) : 'ten';
    setStatus(t('debug.seeding', { set }));
    await wipeAllCards(db); // the photo folders of wiped cards are removed by the start-up sweep (P6 wires FileOps)
    const cards = [...(params.heavy === '1' ? HEAVY : []), ...seedCards(set, undefined, params.lang === 'de' ? 'de' : 'en')];
    const { ids } = await createCards(db, cards.map((c) => ({ ...c, codeCache: buildCodeCache(codeOf({ number: c.number ?? '', codeValue: c.codeValue ?? '' }), c.format) })));
    if (params.photo === '1' && ids.includes('seed-1')) {
      // a front photo through the real capture path: PNG → EXIF-free JPEG (code-kit), staged, moved, row updated
      const temp = await photoToTempJpeg(await fixtureFileUri(require('../../../test/fixtures/images/ean13.png')));
      await replacePhoto(expoFs, 'seed-1', 'front', temp, () => updateCard(db, 'seed-1', { hasFront: true }));
    }
    // store screenshots: this set hides the debug read-outs (variant.ts); every other set brings them back
    if (set === 'store-demo') await setSetting(db, STORE_SHOTS_KEY, '1');
    else await deleteSetting(db, STORE_SHOTS_KEY);
    setStatus(t('debug.seedDone', { n: ids.length }));
    setDone(true);
    router.dismissTo('/'); // back to the Cards list underneath (replace left a second list with a Back button)
  }

  useEffect(() => {
    if (!dev || started.current) return;
    started.current = true;
    (async () => {
      // F5: a preview build may carry a tester's real cards and this route is a link anyone can open: wipe only after the typed word
      if (seedNeedsConfirmation(currentVariant(), await hasWipeableData(db))) {
        setAskWord(true);
        return;
      }
      await seed();
    })().catch((e: Error) => setStatus(`seed failed: ${e.message}`));
    // seed() is a plain function of the route params and db; the effect runs once (started ref)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, dev]);

  if (!dev) return null;
  return (
    <View style={styles.box}>
      {askWord ? (
        <>
          <ThemedText type="smallBold">This test link deletes ALL cards and categories on this phone, then loads test cards.</ThemedText>
          <ThemedText type="small">{`To go on, type ${WIPE_WORD} below. Otherwise go Back: nothing is deleted.`}</ThemedText>
          <TextInput testID="seed-confirm-input" style={styles.input} value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} accessibilityLabel={`Type ${WIPE_WORD} to confirm`} />
          <Button
            testID="seed-confirm-button"
            label="Delete everything and load test cards"
            disabled={!wipeConfirmed(typed)}
            onPress={() => {
              setAskWord(false);
              seed().catch((e: Error) => setStatus(`seed failed: ${e.message}`));
            }}
          />
          <Button testID="seed-cancel-button" variant="secondary" label="Cancel" onPress={() => router.dismissTo('/')} />
        </>
      ) : null}
      <ThemedText testID={done ? 'seed-done' : 'seed-running'}>{status}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: 16, gap: 12 },
  input: { minHeight: 48, borderRadius: 12, paddingHorizontal: 16, fontSize: 16, borderWidth: 1, borderColor: '#888' },
});

// Add – From photo (SPEC §7.4, U4: migrating from Stocard/Klarna/SuperCards by screenshots): the system picker (no
// permission, ≤ 20 images) → code-kit detectBarcodes per image (Vision / ML Kit) → every code found, with its image →
// "Use this code" → Edit with the number to CONFIRM against the card (D41.2: ML Kit misreads some ITF/Code 39/Codabar
// symbols, so a photo read is never saved unchecked). The name is guessed only when exactly one known shop matches
// format + number length. Development builds accept `?fixtures=1` (bundled test images instead of the picker, so a
// Maestro flow can drive the screen on simulators without a photo library).
import { fixtureFileUri } from '../../dev/fixture-file';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { FORMATS, formatFromHint, type FormatId } from '@/engine/barcode/formats';
import { CHAINS } from '@/engine/chains';
import { useT } from '@/hooks/use-t';
import { testToolsEnabled } from '@/lib/variant';
import { useTheme } from '@/hooks/use-theme';

import { detectBarcodes } from '../../../modules/code-kit';

const MAX_IMAGES = 20;
const dev = testToolsEnabled();
const FIXTURES = [require('../../../test/fixtures/images/ean13.png'), require('../../../test/fixtures/images/two-codes.png'), require('../../../test/fixtures/images/itf.png')];

type Found = { image: string; value: string; format: FormatId | undefined; raw: string };

/** A known shop only when exactly one matches the format and the number length (SPEC §7.4). */
function guessName(value: string, format: FormatId | undefined): string {
  if (!format) return '';
  const hits = CHAINS.filter((c) => c.format === format && c.numberLength === value.length);
  return hits.length === 1 ? hits[0].name : '';
}

export default function PhotoScreen() {
  const params = useLocalSearchParams<{ fixtures?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const t = useT();
  const [state, setState] = useState<'picking' | 'reading' | 'done' | 'cancelled'>('picking');
  const [images, setImages] = useState(0);
  const [found, setFound] = useState<Found[]>([]);
  const [empty, setEmpty] = useState(0);
  const started = useRef(false);

  async function run(fromFixtures: boolean) {
    setState('picking');
    let uris: string[];
    if (fromFixtures) {
      uris = [];
      for (const f of FIXTURES) {
        uris.push(await fixtureFileUri(f));
      }
    } else {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: MAX_IMAGES, quality: 1, exif: false });
      if (r.canceled || r.assets.length === 0) {
        setState('cancelled');
        return;
      }
      uris = r.assets.slice(0, MAX_IMAGES).map((a) => a.uri);
    }
    setImages(uris.length);
    setState('reading');
    const out: Found[] = [];
    let none = 0;
    for (const uri of uris) {
      try {
        const codes = await detectBarcodes(uri);
        if (codes.length === 0) none++;
        for (const c of codes) if (c.value !== '' && !out.some((o) => o.value === c.value)) out.push({ image: uri, value: c.value, format: formatFromHint(c.format), raw: c.format });
      } catch {
        none++;
      }
    }
    setFound(out);
    setEmpty(none);
    setState('done');
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run(dev && params.fixtures === '1');
  }, [params.fixtures]);

  function use(f: Found) {
    router.push({ pathname: '/card/[id]/edit', params: { id: 'new', number: f.value, hint: f.raw, name: guessName(f.value, f.format), confirm: '1' } });
  }

  return (
    <ScrollView testID="photo-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      {state === 'reading' ? <ThemedText testID="photo-reading">{t('photo.reading', { n: images })}</ThemedText> : null}
      {state === 'cancelled' ? <ThemedText testID="photo-cancelled">{t('photo.cancelled')}</ThemedText> : null}
      {state === 'done' ? (
        <ThemedText testID="photo-summary" type="smallBold">
          {t('photo.found', { n: found.length, images })}
        </ThemedText>
      ) : null}
      {state === 'done' && empty > 0 ? (
        <ThemedText testID="photo-none" themeColor="textSecondary">
          {t('photo.none', { n: empty })}
        </ThemedText>
      ) : null}
      {found.map((f, i) => (
        <View key={`${f.value}-${i}`} style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
          <Image source={{ uri: f.image }} style={styles.thumb} contentFit="contain" />
          <View style={{ flex: 1, gap: Spacing.one }}>
            <ThemedText testID={`photo-value-${i}`} type="smallBold" numberOfLines={2}>
              {f.value}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {f.format ? FORMATS[f.format].name : f.raw}
            </ThemedText>
            <Button testID={`photo-use-${i}`} label={t('photo.use')} onPress={() => use(f)} />
          </View>
        </View>
      ))}
      {state === 'done' || state === 'cancelled' ? <Button testID="photo-pick" variant="secondary" label={t('photo.pick')} onPress={() => run(false)} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
  row: { flexDirection: 'row', gap: Spacing.three, borderRadius: Radius.card, padding: Spacing.three, alignItems: 'center' },
  thumb: { width: 72, height: 72, borderRadius: 8, backgroundColor: '#ffffff' },
});

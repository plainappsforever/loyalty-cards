// Card (SPEC §7.2, U2): the code from the render-once cache (2D) or the engine (1D), the number large with Copy, the
// format name, "Screen at full brightness" only while raised (§2), balance/expiry/note/categories, favourite, Share,
// Edit, photos, Archive/Delete. Opening counts a use. Tap the code → full screen (rotated when the layout says so).
// Never encodes a 2D code here (D41.1, D42): a missing/stale cache is the only fallback that renders, and it is logged.
import { currentVariant, debugReadoutsVisible, STORE_SHOTS_KEY, testToolsEnabled } from '@/lib/variant';
import * as Brightness from 'expo-brightness';
import * as Clipboard from 'expo-clipboard';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Button } from '@/components/button';
import { CodeView } from '@/components/code-view';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { codeOf, deleteCards, getCard, recordUse, setArchived, setFavourite, type Card } from '@/db/cards';
import { codeKey, getCodeCache, putCodeCache, type CodeCacheEntry } from '@/db/code-cache';
import { listCategories } from '@/db/categories';
import { useSQLiteContext } from '@/db/provider';
import { getSetting, getSettings } from '@/db/settings';
import { FORMATS } from '@/engine/barcode/formats';
import { validate } from '@/engine/barcode/validate';
import { expiryState, formatBalance, groupNumber } from '@/engine/format';
import { useLanguage, useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';
import { buildCodeCache, isTwoD } from '@/lib/code-cache';
import { formatDay } from '@/lib/dates';
import { photoUri, tapAge, takeTap } from '@/lib/services';
import { requestWidgetSync } from '@/lib/widgets';

const testBuild = testToolsEnabled();

type Loaded = { card: Card; cache: CodeCacheEntry | null; source: 'cache' | 'rendered' | 'live'; categories: string[]; now: number };

export default function CardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const t = useT();
  const language = useLanguage();
  const { width, height } = useWindowDimensions();
  const [data, setData] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState(false);
  const [raised, setRaised] = useState<'no' | 'yes' | 'failed'>('no');
  const [copied, setCopied] = useState(false);
  const [full, setFull] = useState(false);
  const [dense, setDense] = useState(false);
  const [openMs, setOpenMs] = useState<number | null>(null);
  // dev read-outs: test builds only, and not while the store-screenshot switch is set
  const [dev, setDev] = useState(false);
  useEffect(() => {
    if (testBuild) void getSetting(db, STORE_SHOTS_KEY).then((v) => setDev(debugReadoutsVisible(currentVariant(), v)));
  }, [db]);
  // dev timing stages (ms since the tile tap): screen mounted → card + cache read → code drawn
  const stages = useRef<{ start?: number | null; loaded?: number | null }>({});

  const load = useCallback(async () => {
    stages.current.start ??= tapAge(id);
    const card = await getCard(db, id);
    if (!card || card.deletedAt !== null) {
      setMissing(true);
      return;
    }
    let cache: CodeCacheEntry | null = null;
    let source: Loaded['source'] = 'live';
    if (isTwoD(card.format)) {
      cache = await getCodeCache(db, id);
      source = 'cache';
      if (!cache || cache.key !== codeKey(card.format, codeOf(card))) {
        // fallback only (cards saved before the cache, or changed outside Edit): render once, store, log
        cache = buildCodeCache(codeOf(card), card.format);
        source = 'rendered';
        console.warn(`CODECACHE miss ${card.format} ${id}`);
        if (cache) void putCodeCache(db, id, cache);
      }
    }
    const names = card.categoryIds.length ? new Map((await listCategories(db)).map((c) => [c.id, c.name])) : new Map<string, string>();
    stages.current.loaded ??= tapAge(id);
    setData({ card, cache, source, categories: card.categoryIds.map((c) => names.get(c) ?? '').filter(Boolean), now: Date.now() });
  }, [db, id]);

  // count the use once, AFTER the card was read: a write queued first would delay the reads (withRead waits for it)
  const counted = useRef(false);
  const loaded = data !== null;
  useEffect(() => {
    if (!loaded || counted.current) return;
    counted.current = true;
    // shortcuts follow the most-used cards (SPEC §6.4: refreshed after every card open, debounced 2 s)
    void recordUse(db, id).then(() => requestWidgetSync(2000));
  }, [db, id, loaded]);
  // reload when coming back from Edit
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // brightness + keep awake while this screen is focused (SPEC §6.3); both behind settings, failures shown, never thrown
  useFocusEffect(
    useCallback(() => {
      let active = true;
      let previous: number | null = null;
      let boosted = false;
      let awake = false;
      (async () => {
        const s = await getSettings(db);
        if (!active) return;
        if (s.keepAwake) {
          await activateKeepAwakeAsync('card').catch(() => undefined);
          awake = true;
        }
        if (!s.brightnessBoost) return;
        try {
          if (Platform.OS === 'ios') previous = await Brightness.getBrightnessAsync();
          await Brightness.setBrightnessAsync(1);
          boosted = true;
          if (active) setRaised('yes');
        } catch {
          if (active) setRaised('failed');
        }
      })();
      return () => {
        active = false;
        setRaised('no');
        if (awake) deactivateKeepAwake('card');
        if (!boosted) return;
        if (Platform.OS === 'ios' && previous !== null) void Brightness.setBrightnessAsync(previous).catch(() => undefined);
        else if (Platform.OS === 'android') void Brightness.restoreSystemBrightnessAsync().catch(() => undefined);
      };
    }, [db])
  );

  const onDrawn = useCallback(() => {
    const ms = takeTap(id);
    if (ms === null) return;
    setOpenMs(ms);
    const st = stages.current;
    console.log(`CARDOPEN ${Platform.OS} ${data?.card.format} ${data?.source} ${ms.toFixed(1)} ms (screen ${st.start?.toFixed(0)} · data ${st.loaded?.toFixed(0)} · drawn ${ms.toFixed(0)})`);
  }, [id, data]);

  if (missing) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText testID="card-missing">{t('card.notFound')}</ThemedText>
      </View>
    );
  }
  if (!data) return <View style={{ flex: 1, backgroundColor: theme.background }} />;
  const { card, cache } = data;
  const info = FORMATS[card.format];
  const value = codeOf(card);
  // 1D: validate (cheap) and draw the canonical value. 2D: the cache was built through renderMatrix, which validated;
  // validate() is NOT called for a cached 2D code because it may trial-encode (D32) — only to explain a missing one.
  const check = card.format === 'none' ? null : info.kind === '2d' && cache ? ({ ok: true, value, notes: [] } as const) : validate(value, card.format);
  const drawable = check?.ok === true && (info.kind === '1d' || cache !== null);
  const codeWidth = width - Spacing.three * 2;
  const exp = expiryState(card.expiry, data.now);

  async function copy() {
    await Clipboard.setStringAsync(card.number);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  async function toggleFavourite() {
    await setFavourite(db, card.id, !card.favourite);
    await load();
  }

  async function archive() {
    await setArchived(db, card.id, !card.archived);
    router.back();
  }

  async function remove() {
    await deleteCards(db, [card.id]);
    router.dismissTo({ pathname: '/', params: { deleted: card.id } });
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: card.name,
          headerRight: () => (
            <Pressable testID="card-favourite" accessibilityLabel={`${t('card.favourite')} ${card.favourite ? '★' : '☆'}`} accessibilityState={{ selected: card.favourite }} onPress={toggleFavourite} hitSlop={10}>
              <ThemedText themeColor="tint" style={styles.star}>
                {card.favourite ? '★' : '☆'}
              </ThemedText>
            </Pressable>
          ),
        }}
      />
      <ScrollView testID="card-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        {drawable ? (
          <Pressable testID="card-code" onPress={() => setFull(true)} style={styles.codeBox} accessibilityLabel={t('card.tapFull')}>
            <CodeView value={check.ok ? check.value : value} format={card.format} cache={cache} width={codeWidth} height={Math.round(height * 0.4)} onDrawn={onDrawn} onDense={setDense} />
          </Pressable>
        ) : (
          <View testID="card-no-code" style={[styles.noCode, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText themeColor="textSecondary">{card.format === 'none' || !check || check.ok ? t('card.noCode') : t('card.cannotDraw', { format: info.name, reason: t(`edit.invalid.${check.error}`) })}</ThemedText>
          </View>
        )}
        {dense ? (
          <ThemedText testID="card-dense" themeColor="danger" type="small">
            {t('card.dense')}
          </ThemedText>
        ) : null}
        {raised === 'yes' ? (
          <ThemedText testID="brightness-line" type="small" themeColor="textSecondary">
            ☀ {t('card.brightness')}
          </ThemedText>
        ) : raised === 'failed' ? (
          <ThemedText testID="brightness-failed" type="small" themeColor="danger">
            {t('card.brightnessFailed')}
          </ThemedText>
        ) : null}
        {dev && openMs !== null ? (
          <ThemedText testID="open-ms" type="small" themeColor="textSecondary">
            {t('card.openTime', { ms: Math.round(openMs), source: data.source })}
          </ThemedText>
        ) : null}
        <ThemedText testID="card-format" type="small" themeColor="textSecondary">
          {card.format === 'none' ? t('format.none') : info.name}
        </ThemedText>
        <View style={styles.numberRow}>
          <ThemedText testID="card-number" selectable style={styles.number}>
            {groupNumber(card.number)}
          </ThemedText>
          <Pressable testID="card-copy" onPress={copy} hitSlop={8} style={[styles.copy, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold">{copied ? t('card.copied') : t('card.copy')}</ThemedText>
          </Pressable>
        </View>

        {card.balance !== '' ? <ThemedText testID="card-balance">{`${t('card.balance')}: ${formatBalance(card.balance, card.balanceCurrency, language)}`}</ThemedText> : null}
        {card.validFrom !== null ? <ThemedText>{t('card.validFrom', { date: formatDay(card.validFrom, language) })}</ThemedText> : null}
        {exp.state !== 'none' ? (
          <ThemedText testID="card-expiry" themeColor={exp.state === 'ok' ? 'text' : 'danger'}>
            {exp.state === 'expired' ? t('card.expired', { date: formatDay(card.expiry, language) }) : exp.state === 'soon' ? t('card.expiresSoon', { date: formatDay(card.expiry, language), days: exp.days ?? 0 }) : t('card.expires', { date: formatDay(card.expiry, language) })}
          </ThemedText>
        ) : null}
        {card.note !== '' ? (
          <View style={{ gap: Spacing.one }}>
            <ThemedText type="smallBold">{t('card.note')}</ThemedText>
            <ThemedText testID="card-note" selectable>
              {card.note}
            </ThemedText>
          </View>
        ) : null}
        {data.categories.length ? (
          <ThemedText testID="card-categories" type="small" themeColor="textSecondary">
            {data.categories.join(' · ')}
          </ThemedText>
        ) : null}
        {card.hasFront || card.hasBack ? (
          <View style={styles.photos}>
            {(['front', 'back'] as const)
              .filter((s) => (s === 'front' ? card.hasFront : card.hasBack))
              .map((s) => (
                <View key={s} style={{ flex: 1, gap: Spacing.one }}>
                  <Image testID={`card-photo-${s}`} source={{ uri: photoUri(card.id, s, card.updatedAt) }} style={styles.photo} contentFit="cover" />
                  <ThemedText type="small" themeColor="textSecondary">
                    {t(s === 'front' ? 'card.front' : 'card.back')}
                  </ThemedText>
                </View>
              ))}
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button testID="card-share" label={t('card.share')} onPress={() => router.push(`/card/${card.id}/share`)} />
          <Button testID="card-edit" label={t('card.edit')} variant="secondary" onPress={() => router.push(`/card/${card.id}/edit`)} />
          <Button testID="card-archive" label={card.archived ? t('card.unarchive') : t('common.archive')} variant="secondary" onPress={archive} />
          <Button testID="card-delete" label={t('common.delete')} variant="secondary" onPress={remove} />
        </View>
      </ScrollView>

      <Modal visible={full} animationType="fade" onRequestClose={() => setFull(false)} supportedOrientations={['portrait']}>
        <Pressable testID="code-fullscreen" style={styles.full} onPress={() => setFull(false)}>
          {drawable ? <CodeView value={check.ok ? check.value : value} format={card.format} cache={cache} width={width - 24} height={height - 120} /> : null}
          <ThemedText style={[styles.fullNumber, { fontFamily: Fonts.mono }]}>{groupNumber(card.number)}</ThemedText>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  content: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.six },
  codeBox: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff', borderRadius: Radius.card, paddingVertical: Spacing.three },
  noCode: { borderRadius: Radius.card, padding: Spacing.four, alignItems: 'center' },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, marginTop: Spacing.two },
  number: { flex: 1, fontFamily: Fonts.mono, fontSize: 28, lineHeight: 34, fontWeight: 700 },
  copy: { borderRadius: 10, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  star: { fontSize: 26, lineHeight: 30 },
  photos: { flexDirection: 'row', gap: Spacing.two },
  photo: { width: '100%', aspectRatio: 1.586, borderRadius: 10 },
  actions: { gap: Spacing.two, marginTop: Spacing.four },
  full: { flex: 1, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  fullNumber: { color: '#000000', fontSize: 24, fontWeight: 700 },
});

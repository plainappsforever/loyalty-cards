// Cards (SPEC §7.1, 1.1.0 poster home): the card used most as a poster (colour band, code, number), search + one
// "Sort & filter" sheet (category chips, archived, sort modes), the other cards as a deck of colour bands, "+" in the header
// (Scan / Type / From photo / Import), gear for Settings. Empty state = three big buttons, no onboarding. A delete on
// the card screen comes back here with `deleted=<id>`: an 8-second Undo bar (SPEC §9), then the purge.
import { Link, Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuickActionRouting } from 'expo-quick-actions/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { Poster, CARD_RATIO } from '@/components/poster';
import { ThemedText } from '@/components/themed-text';
import { Colors, Paper, Radius, Spacing } from '@/constants/theme';
import { getCard, listCards, undoDelete, UNDO_WINDOW_MS, type Card } from '@/db/cards';
import { listCategories, type Category } from '@/db/categories';
import { useSQLiteContext } from '@/db/provider';
import { getSettings, SORT_MODES, updateSetting, type SortMode } from '@/db/settings';
import { textColorOn } from '@/engine/format';
import { searchCards, searchKey } from '@/engine/search';
import { sortCards } from '@/engine/sort';
import { useLanguage, useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';
import { purgeExpired } from '@/lib/files';
import { expoFs } from '@/lib/fs-expo';
import { markTap } from '@/lib/services';
import { requestWidgetSync } from '@/lib/widgets';

type Row = Card & { categoryNames: string[] };

/** Logs the shortcut (Metro log `[shortcuts] open …`); returning nothing lets the router open `params.href`. */
function logShortcut(action: { id: string; params?: Record<string, unknown> | null }): void {
  console.log(`[shortcuts] open ${String(action.params?.href ?? action.id)}`);
}

export default function CardsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const t = useT();
  const language = useLanguage();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ deleted?: string }>();
  const [cards, setCards] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState<SortMode>('manual');
  const [sheet, setSheet] = useState(false);
  const [now, setNow] = useState(0);
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // App shortcuts (SPEC §6.4, A11): `params.href` = /card/<id>; on a cold start the initial action is routed once this
  // screen (below the root layout) is mounted.
  useQuickActionRouting(logShortcut);

  const load = useCallback(async () => {
    const [list, cats, settings] = await Promise.all([listCards(db, archived ? 'only' : 'exclude'), listCategories(db), getSettings(db)]);
    const names = new Map(cats.map((c) => [c.id, c.name]));
    setCards(list.map((c) => ({ ...c, categoryNames: c.categoryIds.map((id) => names.get(id) ?? '') })));
    setCategories(cats);
    setSort(settings.sort);
    setNow(Date.now());
    setLoaded(true);
  }, [db, archived]);

  useFocusEffect(
    useCallback(() => {
      void load();
      // back on the list after an add/edit/import/delete: widgets and shortcuts follow (debounced)
      requestWidgetSync();
    }, [load])
  );

  // a card deleted on its screen: offer Undo for the window, then purge rows (and files) for good
  useEffect(() => {
    const id = params.deleted;
    if (!id) return;
    router.setParams({ deleted: undefined });
    void getCard(db, id).then((c) => c && setUndo({ id, name: c.name }));
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => {
      setUndo(null);
      void purgeExpired(expoFs, db).catch(() => undefined);
    }, UNDO_WINDOW_MS + 200);
  }, [params.deleted, db, router]);
  useEffect(() => () => void (undoTimer.current && clearTimeout(undoTimer.current)), []);

  async function undoNow() {
    if (!undo) return;
    await undoDelete(db, [undo.id]);
    setUndo(null);
    await load();
  }

  async function chooseSort(mode: SortMode) {
    setSort(mode);
    await updateSetting(db, 'sort', mode);
  }

  const keys = useMemo(() => cards.map((c) => searchKey(c)), [cards]);
  const shown = useMemo(() => {
    const inCategory = category ? cards.filter((c) => c.categoryIds.includes(category)) : cards;
    const searched = query.trim() ? searchCards(inCategory, query, category ? undefined : keys) : inCategory;
    return sortCards(searched, sort, language);
  }, [cards, category, query, keys, sort, language]);

  const wide = width >= 600;
  const columns = wide ? 2 : 1;
  const gutter = Spacing.three;
  const posterWidth = Math.min(width - gutter * 2, 520);
  const bandWidth = wide ? (width - gutter * 2 - Spacing.two) / 2 : width - gutter * 2;
  const empty = loaded && cards.length === 0 && !archived;
  const filtering = query.trim() !== '' || category !== null;
  const filtersOn = category !== null || archived || sort !== 'manual';

  // the poster: the card used most (ties: last used, then list order), only on the plain home view
  const poster = useMemo(() => {
    if (archived || filtering || cards.length === 0) return null;
    return [...cards].sort((a, b) => b.useCount - a.useCount || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || a.sortIndex - b.sortIndex)[0] ?? null;
  }, [cards, archived, filtering]);
  // test ids stay `tile-<position in the shown list>` so the card keeps its id whichever way it is drawn
  const deck = useMemo(() => shown.map((card, index) => ({ card, index })).filter((e) => e.card.id !== poster?.id), [shown, poster]);
  const posterIndex = poster ? shown.findIndex((c) => c.id === poster.id) : -1;
  const lastRowStart = Math.floor((deck.length - 1) / columns) * columns;
  const bandFull = Math.round(bandWidth / CARD_RATIO);

  function open(id: string) {
    markTap(id);
    router.push(`/card/${id}`);
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.header}>
              <Link href="/settings" asChild>
                <Pressable testID="open-settings" accessibilityRole="button" accessibilityLabel={t('cards.settings')} hitSlop={10}>
                  <SymbolView name="gearshape" tintColor={theme.tintText} size={22} fallback={<ThemedText themeColor="tintText">{'⚙'}</ThemedText>} />
                </Pressable>
              </Link>
              <Link href="/new" asChild>
                <Pressable testID="add-card" accessibilityRole="button" accessibilityLabel={t('cards.add')} hitSlop={10}>
                  <SymbolView name="plus" tintColor={theme.tintText} size={24} weight="semibold" fallback={<ThemedText themeColor="tintText" style={styles.plus}>+</ThemedText>} />
                </Pressable>
              </Link>
            </View>
          ),
        }}
      />
      {empty ? (
        <View testID="home-screen" style={styles.empty}>
          <View style={[styles.ghost, { borderColor: theme.border, width: Math.min(width - Spacing.four * 2, 300), height: Math.round(Math.min(width - Spacing.four * 2, 300) / CARD_RATIO) }]}>
            <View style={[styles.ghostBand, { borderColor: theme.textSecondary }]} />
            <View style={styles.ghostBars}>
              {[3, 7, 2, 5, 3, 8, 2, 4, 6, 2, 3].map((w, i) => (
                <View key={i} style={[styles.ghostBar, { width: w, borderColor: theme.textSecondary }]} />
              ))}
            </View>
          </View>
          <ThemedText testID="cards-empty" style={styles.emptyText}>
            {t('cards.empty')}
          </ThemedText>
          <Button testID="empty-scan" label={t('cards.emptyScan')} onPress={() => router.push('/add/scan')} />
          <Button testID="empty-type" label={t('cards.emptyType')} variant="secondary" onPress={() => router.push('/card/new/edit')} />
          <Button testID="empty-import" label={t('cards.emptyImport')} variant="secondary" onPress={() => router.push('/data')} />
        </View>
      ) : (
        <FlatList
          testID="home-screen"
          key={columns}
          numColumns={columns}
          data={deck}
          keyExtractor={(e) => e.card.id}
          contentContainerStyle={styles.content}
          columnWrapperStyle={wide ? { gap: Spacing.two } : undefined}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          initialNumToRender={14}
          ListHeaderComponent={
            <View style={styles.headerBlock}>
              {poster ? (
                <View style={styles.posterWrap}>
                  <Poster key={poster.id} now={now} testID={`tile-${posterIndex}`} card={poster} width={posterWidth} onPress={() => open(poster.id)} />
                </View>
              ) : null}
              <View style={styles.searchRow}>
                <TextInput
                  testID="search-input"
                  accessibilityLabel={t('cards.search')}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t('cards.search')}
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                  clearButtonMode="while-editing"
                  autoCorrect={false}
                />
                <Chip testID="sort-filter" label={t('cards.sortFilter')} selected={filtersOn} onPress={() => setSheet(true)} style={styles.sortButton} />
              </View>
              <ThemedText testID="cards-count" type="small" themeColor="textSecondary">
                {query.trim() && shown.length === 0 ? t('cards.noMatch', { q: query.trim() }) : t('cards.count', { n: shown.length })}
              </ThemedText>
            </View>
          }
          renderItem={({ item, index }) => {
            const whole = index >= lastRowStart;
            const { card, index: position } = item;
            const ink = textColorOn(card.color);
            return (
              <Pressable
                testID={`tile-${position}`}
                accessibilityRole="button"
                accessibilityLabel={card.favourite ? `${card.name}, ${t('common.favourite')}` : card.name}
                onPress={() => open(card.id)}
                style={({ pressed }) => [{ width: bandWidth, height: whole ? bandFull : BAND_VISIBLE + Radius.card, marginBottom: whole ? 0 : -Radius.card }, styles.deckCard, pressed && { opacity: 0.8 }]}>
                <View style={[styles.deckBand, { backgroundColor: card.color }]}>
                  <ThemedText numberOfLines={1} style={[styles.deckName, { color: ink }]}>
                    {card.name}
                  </ThemedText>
                  {card.favourite ? <SymbolView name="star.fill" tintColor={ink} size={14} fallback={<ThemedText style={{ color: ink }}>{'★'}</ThemedText>} /> : null}
                </View>
                {whole ? (
                  <View style={styles.deckPaper}>
                    <ThemedText numeric numberOfLines={1} style={styles.deckNumber}>
                      {card.number}
                    </ThemedText>
                  </View>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
      <Modal visible={sheet} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(false)}>
        <ScrollView testID="filter-sheet" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
          <ThemedText type="subtitle">{t('cards.sortFilter')}</ThemedText>
          <ThemedText type="smallBold">{t('cards.all')}</ThemedText>
          <View style={styles.chips}>
            <Chip testID="category-all" label={t('cards.all')} selected={category === null} onPress={() => setCategory(null)} />
            {categories.map((c, i) => (
              <Chip key={c.id} testID={`category-chip-${i}`} label={c.name} selected={category === c.id} onPress={() => setCategory(category === c.id ? null : c.id)} />
            ))}
            <Chip testID="show-archived" label={t('cards.archived')} selected={archived} onPress={() => setArchived(!archived)} />
          </View>
          <ThemedText type="smallBold">{t('settings.sort')}</ThemedText>
          <View style={styles.chips}>
            {SORT_MODES.map((m) => (
              <Chip key={m} testID={`sort-${m}`} label={t(`sort.${m}`)} selected={sort === m} onPress={() => chooseSort(m)} />
            ))}
          </View>
          <Button testID="filter-done" label={t('common.ok')} onPress={() => setSheet(false)} />
        </ScrollView>
      </Modal>
      {undo ? (
        <View testID="undo-bar" accessibilityLiveRegion="polite" style={[styles.undoBar, { backgroundColor: theme.text }]}>
          <ThemedText style={{ color: theme.background, flex: 1 }} numberOfLines={1}>
            {t('cards.deleted', { name: undo.name })}
          </ThemedText>
          <Pressable testID="undo-delete" accessibilityRole="button" accessibilityLabel={t('common.undo')} onPress={undoNow} hitSlop={8}>
            <ThemedText style={{ color: theme.background === Colors.dark.background ? Colors.light.tintText : Colors.dark.tintText, fontWeight: 700 }}>{t('common.undo')}</ThemedText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const BAND_VISIBLE = 44;

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  plus: { fontSize: 30, lineHeight: 34, fontWeight: 400 },
  content: { padding: Spacing.three, paddingBottom: Spacing.six },
  headerBlock: { gap: Spacing.two, paddingBottom: Spacing.three },
  posterWrap: { alignItems: 'center', paddingBottom: Spacing.one },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  search: { flex: 1, minHeight: 44, borderRadius: Radius.control, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.three, fontSize: 16 },
  sortButton: { minHeight: 44 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  sheet: { padding: Spacing.four, gap: Spacing.three },
  deckCard: { borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card, overflow: 'hidden', backgroundColor: Paper.background },
  deckBand: { height: BAND_VISIBLE, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, paddingHorizontal: Spacing.three },
  deckName: { flex: 1, fontSize: 17, fontWeight: 600 },
  deckPaper: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  deckNumber: { color: Paper.ink, fontSize: 17, letterSpacing: 1.5 },
  empty: { flex: 1, padding: Spacing.four, gap: Spacing.three, justifyContent: 'center' },
  emptyText: { textAlign: 'center', marginBottom: Spacing.two },
  ghost: { alignSelf: 'center', borderWidth: 2, borderStyle: 'dashed', borderRadius: Radius.card, overflow: 'hidden', marginBottom: Spacing.two },
  ghostBand: { height: 30, borderBottomWidth: 2, borderStyle: 'dashed' },
  ghostBars: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  ghostBar: { height: '55%', borderWidth: 2, borderStyle: 'dashed' },
  undoBar: { position: 'absolute', left: Spacing.three, right: Spacing.three, bottom: Spacing.five, borderRadius: Radius.control, padding: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});

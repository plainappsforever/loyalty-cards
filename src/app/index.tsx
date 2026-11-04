// Cards (SPEC §7.1): tiles (colour + initials, favourites first in manual mode), search, category chips, sort modes,
// archived toggle, "+" (Scan / Type / From photo / Import). Empty state = three big buttons, no onboarding. A delete on
// the card screen comes back here with `deleted=<id>`: an 8-second Undo bar (SPEC §9), then the purge.
import { Link, Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuickActionRouting } from 'expo-quick-actions/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getCard, listCards, undoDelete, UNDO_WINDOW_MS, type Card } from '@/db/cards';
import { listCategories, type Category } from '@/db/categories';
import { useSQLiteContext } from '@/db/provider';
import { getSettings, SORT_MODES, updateSetting, type SortMode } from '@/db/settings';
import { initials, textColorOn } from '@/engine/format';
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

  const columns = width > 600 ? 3 : 2;
  const tileWidth = (width - Spacing.three * 2 - Spacing.two * (columns - 1)) / columns;
  const empty = loaded && cards.length === 0 && !archived;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.header}>
              <Link href="/settings" asChild>
                <Pressable testID="open-settings" accessibilityRole="button" accessibilityLabel={t('cards.settings')} hitSlop={8}>
                  <ThemedText themeColor="tint">{t('cards.settings')}</ThemedText>
                </Pressable>
              </Link>
              <Link href="/new" asChild>
                <Pressable testID="add-card" accessibilityRole="button" accessibilityLabel={t('cards.add')} hitSlop={8}>
                  <ThemedText themeColor="tint" style={styles.plus}>
                    +
                  </ThemedText>
                </Pressable>
              </Link>
            </View>
          ),
        }}
      />
      {empty ? (
        <View testID="home-screen" style={styles.empty}>
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
          data={shown}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.content}
          columnWrapperStyle={{ gap: Spacing.two }}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          ListHeaderComponent={
            <View style={styles.headerBlock}>
              <TextInput
                testID="search-input"
                accessibilityLabel={t('cards.search')}
                value={query}
                onChangeText={setQuery}
                placeholder={t('cards.search')}
                placeholderTextColor={theme.textSecondary}
                style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                clearButtonMode="while-editing"
                autoCorrect={false}
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
                <Chip testID="category-all" label={t('cards.all')} selected={category === null} onPress={() => setCategory(null)} />
                {categories.map((c, i) => (
                  <Chip key={c.id} testID={`category-chip-${i}`} label={c.name} selected={category === c.id} onPress={() => setCategory(category === c.id ? null : c.id)} />
                ))}
                <Chip testID="show-archived" label={t('cards.archived')} selected={archived} onPress={() => setArchived(!archived)} />
              </ScrollView>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
                {SORT_MODES.map((m) => (
                  <Chip key={m} testID={`sort-${m}`} label={t(`sort.${m}`)} selected={sort === m} onPress={() => chooseSort(m)} />
                ))}
              </ScrollView>
              <ThemedText testID="cards-count" type="small" themeColor="textSecondary">
                {query.trim() && shown.length === 0 ? t('cards.noMatch', { q: query.trim() }) : t('cards.count', { n: shown.length })}
              </ThemedText>
            </View>
          }
          renderItem={({ item, index }) => (
            <Pressable
              testID={`tile-${index}`}
              accessibilityRole="button"
              accessibilityLabel={item.favourite ? `${item.name}, ${t('common.favourite')}` : item.name}
              onPress={() => {
                markTap(item.id);
                router.push(`/card/${item.id}`);
              }}
              style={({ pressed }) => [{ width: tileWidth }, pressed && { opacity: 0.7 }]}>
              <View style={[styles.tile, { backgroundColor: item.color }]}>
                <ThemedText style={[styles.initials, { color: textColorOn(item.color) }]}>{initials(item.name)}</ThemedText>
                {item.favourite ? <ThemedText style={[styles.star, { color: textColorOn(item.color) }]}>★</ThemedText> : null}
              </View>
              <ThemedText type="smallBold" numberOfLines={1} style={styles.tileName}>
                {item.name}
              </ThemedText>
            </Pressable>
          )}
        />
      )}
      {undo ? (
        <View testID="undo-bar" accessibilityLiveRegion="polite" style={[styles.undoBar, { backgroundColor: theme.text }]}>
          <ThemedText style={{ color: theme.background, flex: 1 }} numberOfLines={1}>
            {t('cards.deleted', { name: undo.name })}
          </ThemedText>
          <Pressable testID="undo-delete" accessibilityRole="button" accessibilityLabel={t('common.undo')} onPress={undoNow} hitSlop={8}>
            <ThemedText style={{ color: theme.tint, fontWeight: 700 }}>{t('common.undo')}</ThemedText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  plus: { fontSize: 30, lineHeight: 34, fontWeight: 400 },
  content: { padding: Spacing.three, gap: Spacing.three },
  headerBlock: { gap: Spacing.two },
  search: { minHeight: 44, borderRadius: 12, paddingHorizontal: Spacing.three, fontSize: 16 },
  chips: { gap: Spacing.two, paddingVertical: Spacing.one },
  tile: { aspectRatio: 1.586, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 30, lineHeight: 36, fontWeight: 700 },
  star: { position: 'absolute', top: 6, right: 10, fontSize: 18 },
  tileName: { marginTop: Spacing.one },
  empty: { flex: 1, padding: Spacing.four, gap: Spacing.three, justifyContent: 'center' },
  emptyText: { textAlign: 'center', marginBottom: Spacing.two },
  undoBar: { position: 'absolute', left: Spacing.three, right: Spacing.three, bottom: Spacing.five, borderRadius: 12, padding: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});

// Categories (SPEC §7.6): add, rename, reorder (up/down), delete — the cards stay (links cascade). Names are unique
// ignoring case and trimmed (D25, D37.5); a refused name shows why.
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { createCategory, deleteCategory, listCategories, renameCategory, setCategoryOrder, type Category } from '@/db/categories';
import { useSQLiteContext } from '@/db/provider';
import { useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';

export default function CategoriesScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const t = useT();
  const [list, setList] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setList(await listCategories(db)), [db]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const explain = (e: unknown) => setError(e instanceof Error && /UNIQUE/i.test(e.message) ? t('categories.exists') : e instanceof Error ? e.message : String(e));

  async function add() {
    setError(null);
    try {
      await createCategory(db, name);
      setName('');
      Keyboard.dismiss();
      await load();
    } catch (e) {
      explain(e);
    }
  }

  async function rename() {
    if (!editing) return;
    setError(null);
    try {
      await renameCategory(db, editing.id, editing.name);
      setEditing(null);
      Keyboard.dismiss();
      await load();
    } catch (e) {
      explain(e);
    }
  }

  async function move(index: number, by: -1 | 1) {
    const ids = list.map((c) => c.id);
    const [id] = ids.splice(index, 1);
    ids.splice(Math.max(0, Math.min(ids.length, index + by)), 0, id);
    await setCategoryOrder(db, ids);
    await load();
  }

  const input = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];
  return (
    <ScrollView testID="categories-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.row}>
        <TextInput testID="category-new-input" style={[input, { flex: 1 }]} value={name} onChangeText={setName} placeholder={t('categories.new')} placeholderTextColor={theme.textSecondary} maxLength={40} onSubmitEditing={add} />
        <Button testID="category-add" label={t('categories.add')} disabled={name.trim() === ''} onPress={add} />
      </View>
      {error ? (
        <ThemedText testID="category-error" themeColor="danger">
          {error}
        </ThemedText>
      ) : null}
      {list.length === 0 ? <ThemedText themeColor="textSecondary">{t('categories.empty')}</ThemedText> : null}
      {list.map((c, i) => (
        <View key={c.id} testID={`category-row-${i}`} style={[styles.item, { backgroundColor: theme.backgroundElement }]}>
          {editing?.id === c.id ? (
            <View style={styles.row}>
              <TextInput testID={`category-rename-input-${i}`} style={[input, { flex: 1, backgroundColor: theme.background }]} value={editing.name} onChangeText={(v) => setEditing({ id: c.id, name: v })} maxLength={40} autoFocus onSubmitEditing={rename} />
              <Button testID={`category-rename-save-${i}`} label={t('common.save')} onPress={rename} />
            </View>
          ) : (
            <Pressable testID={`category-name-${i}`} onPress={() => setEditing({ id: c.id, name: c.name })} accessibilityHint={t('categories.rename')}>
              <ThemedText type="smallBold">{c.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t('categories.cards', { n: c.cardCount })}
              </ThemedText>
            </Pressable>
          )}
          <View style={styles.actions}>
            <Pressable testID={`category-up-${i}`} disabled={i === 0} onPress={() => move(i, -1)} hitSlop={6} accessibilityLabel={t('categories.up')}>
              <ThemedText themeColor={i === 0 ? 'textSecondary' : 'tint'}>▲</ThemedText>
            </Pressable>
            <Pressable testID={`category-down-${i}`} disabled={i === list.length - 1} onPress={() => move(i, 1)} hitSlop={6} accessibilityLabel={t('categories.down')}>
              <ThemedText themeColor={i === list.length - 1 ? 'textSecondary' : 'tint'}>▼</ThemedText>
            </Pressable>
            <Pressable
              testID={`category-delete-${i}`}
              onPress={async () => {
                await deleteCategory(db, c.id);
                await load();
              }}
              hitSlop={6}>
              <ThemedText themeColor="danger">{t('common.delete')}</ThemedText>
            </Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  input: { minHeight: 48, borderRadius: 12, paddingHorizontal: Spacing.three, fontSize: 16 },
  item: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  actions: { flexDirection: 'row', gap: Spacing.four, alignItems: 'center' },
});

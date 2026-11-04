// Sort modes (SPEC §5.6, D25 Q5): manual (sort_index), name (locale collation), most used (use_count desc, then last
// used), recent (last_used_at desc). Favourites always first within the chosen mode. Pure; stable.
export type SortMode = 'manual' | 'name' | 'most_used' | 'recent';

export type Sortable = { id: string; name: string; favourite: boolean; sortIndex: number; useCount: number; lastUsedAt: number | null; createdAt: number };

/**
 * Name collation (SPEC §5.6 "accents secondary", D45.2): `accent` = ICU secondary strength — base letters first, then
 * accents (Zurich before Zürich, never a tie); case alone still ties and falls to the manual order. Numeric: Card 9 <
 * Card 10. 'base' made accented and unaccented names EQUAL (B3 SO-10). The Hermes self-test checks these options.
 */
export const NAME_COLLATION: Readonly<Intl.CollatorOptions> = { sensitivity: 'accent', numeric: true };

export function sortCards<T extends Sortable>(cards: readonly T[], mode: SortMode, locale = 'en', favouritesFirst = true): T[] {
  const collator = new Intl.Collator(locale, NAME_COLLATION);
  const cmp = (a: T, b: T): number => {
    if (favouritesFirst && a.favourite !== b.favourite) return a.favourite ? -1 : 1;
    switch (mode) {
      case 'name':
        return collator.compare(a.name, b.name) || a.sortIndex - b.sortIndex;
      case 'most_used':
        return b.useCount - a.useCount || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || a.sortIndex - b.sortIndex;
      case 'recent':
        return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || a.sortIndex - b.sortIndex;
      default:
        return a.sortIndex - b.sortIndex || a.createdAt - b.createdAt;
    }
  };
  return [...cards].sort(cmp);
}

/** The n most used cards (shortcuts, widgets default): use count, then last used, then manual order; never archived. */
export function mostUsed<T extends Sortable & { archived: boolean }>(cards: readonly T[], n: number): T[] {
  return sortCards(
    cards.filter((c) => !c.archived),
    'most_used',
    'en',
    false
  ).slice(0, n);
}

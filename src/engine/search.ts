// Search (SPEC §5.6): case- and diacritic-insensitive over name, number, note and category names; every query word
// must match somewhere. ≤ 50 ms for 500 cards (A17, measured in search.test.ts).
export type Searchable = { name: string; number: string; note: string; categoryNames?: readonly string[] };

export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase();
}

/** Pre-folded haystack for a card (compute once per list, not per keystroke). */
export function searchKey(c: Searchable): string {
  return foldText([c.name, c.number, c.note, ...(c.categoryNames ?? [])].join('\n'));
}

export function matches(key: string, query: string): boolean {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  return words.every((w) => key.includes(w));
}

export function searchCards<T extends Searchable>(cards: readonly T[], query: string, keys?: readonly string[]): T[] {
  if (query.trim() === '') return [...cards];
  return cards.filter((c, i) => matches(keys ? keys[i] : searchKey(c), query));
}

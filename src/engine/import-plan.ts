// Import never overwrites (L26, SPEC §9): a card whose number + format already exists is a duplicate; the user chooses
// once per import to skip them (default) or keep both. The summary is exact: imported / skipped (with reasons) / duplicates.
import type { FormatId } from './barcode/formats';
import type { ImportedCard, Skipped } from './card-data';

export type DuplicateRule = 'skip' | 'keepBoth';
export type ExistingKey = { number: string; format: FormatId };

export type ImportPlan<T extends ImportedCard = ImportedCard> = {
  toCreate: T[];
  duplicates: T[];
  skipped: Skipped[];
  summary: { imported: number; skipped: number; duplicates: number };
};

const key = (c: ExistingKey) => `${c.format}\u0000${c.number}`;

export function planImport<T extends ImportedCard>(cards: readonly T[], existing: readonly ExistingKey[], skipped: readonly Skipped[], rule: DuplicateRule = 'skip'): ImportPlan<T> {
  const seen = new Set(existing.map(key));
  const toCreate: T[] = [];
  const duplicates: T[] = [];
  for (const c of cards) {
    const k = key(c);
    if (seen.has(k)) {
      duplicates.push(c);
      if (rule === 'keepBoth') toCreate.push(c);
      continue;
    }
    seen.add(k); // a duplicate inside the same file counts once
    toCreate.push(c);
  }
  return { toCreate, duplicates, skipped: [...skipped], summary: { imported: toCreate.length, skipped: skipped.length, duplicates: rule === 'skip' ? duplicates.length : 0 } };
}

/** "12 imported, 2 skipped, 1 duplicate skipped" — the exact summary line (A13); the UI translates the words. */
export function summaryParts(plan: ImportPlan): { imported: number; skipped: number; duplicates: number } {
  return plan.summary;
}

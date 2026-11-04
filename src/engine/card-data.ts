// The card as the interchange engines see it (no ids, no database): what Catima, our backup, generic CSV and the share
// payload carry. `categories` are names. Images are bytes (PNG/JPEG) on import and export.
import type { FormatId } from './barcode/formats';
import { isCurrencyCode } from './currency';

export type CardImages = { front?: Uint8Array; back?: Uint8Array; icon?: Uint8Array };

export type CardData = {
  name: string;
  number: string;
  /** Barcode content when it differs from the printed number; '' = same. */
  codeValue: string;
  format: FormatId;
  /** #rrggbb lower case. */
  color: string;
  note: string;
  balance: string;
  balanceCurrency: string;
  validFrom: number | null;
  expiry: number | null;
  favourite: boolean;
  archived: boolean;
  lastUsedAt: number | null;
  categories: string[];
};

export type ImportedCard = CardData & { images: CardImages };

/** One rejected input row and why (shown in the import summary, SPEC §9). */
export type Skipped = { row: number; reason: SkipReason; detail?: string };
export type SkipReason = 'emptyName' | 'emptyNumber' | 'badField' | 'badRow';

export const COLOR_RE = /^#[0-9a-f]{6}$/;

export function emptyCardData(): CardData {
  return { name: '', number: '', codeValue: '', format: 'none', color: '#2c3e50', note: '', balance: '', balanceCurrency: '', validFrom: null, expiry: null, favourite: false, archived: false, lastUsedAt: null, categories: [] };
}

/** Trims a name to the stored limit (80 CHARACTERS as SQLite counts them, SPEC §4.2 — never half an emoji); '' stays ''. */
export function cleanName(name: string): string {
  const s = name.replace(/\s+/g, ' ').trim();
  return [...s].length <= 80 ? s : [...s].slice(0, 80).join('').trim();
}

/** Category identity: ASCII case folded, exactly like SQLite's COLLATE NOCASE on categories.name (D26, D33 Q5). */
export const categoryKey = (name: string): string => name.trim().replace(/[A-Z]+/g, (m) => m.toLowerCase());

/**
 * "Food" and "food" are one category; the FIRST spelling in `order` wins (D33 Q5). Rewrites every card's categories to
 * that spelling without duplicates and returns the merged list (order kept).
 */
export function mergeCategories(order: readonly string[], cards: { categories: string[] }[]): string[] {
  const first = new Map<string, string>();
  for (const g of [...order, ...cards.flatMap((c) => c.categories)]) {
    const t = g.trim();
    if (t !== '' && !first.has(categoryKey(t))) first.set(categoryKey(t), t);
  }
  for (const c of cards) c.categories = [...new Set(c.categories.map((g) => first.get(categoryKey(g)) ?? g.trim()))];
  return [...first.values()];
}

/** A decimal string as typed ('' = none): digits with an optional sign and one . or , separator; anything else → ''. */
export function cleanBalance(value: string): string {
  const s = value.trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return '';
  return /^-?0+(\.0+)?$/.test(s) ? '' : s; // Catima writes 0 for "no balance" (review R4)
}

/** An ISO 4217 code (upper-cased) or '' (= points). Anything else is not a currency Catima or Android accepts (review M5). */
export function cleanCurrency(value: string): string {
  const s = value.trim().toUpperCase();
  return isCurrencyCode(s) ? s : '';
}

/** Import: a balance unit that is not an ISO code ("PTS", "Meilen") is kept visible in the note instead of vanishing. */
export function currencyKeepingNote(value: string, note: string): { currency: string; note: string } {
  const currency = cleanCurrency(value);
  const raw = value.trim();
  if (currency !== '' || raw === '') return { currency, note };
  return { currency, note: note === '' ? `Balance unit: ${raw}` : `${note}\nBalance unit: ${raw}` };
}

/** Values below this are not milliseconds of any real date (1e11 ms = 1973-03-03): a seconds timestamp slipped in (review R3). */
const SECONDS_LIMIT_MS = 100_000_000_000;

/** Unix ms from a Catima/backup number; a seconds value (hand-made files, the docs only say "UNIX timestamp") is promoted. */
export function cleanTimestampMs(value: string | number | null | undefined, unit: 'ms' | 's' = 'ms'): number | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!/^-?\d+$/.test(s)) return null;
  let n = Number(s);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  if (unit === 's' || n < SECONDS_LIMIT_MS) n *= 1000;
  return n;
}

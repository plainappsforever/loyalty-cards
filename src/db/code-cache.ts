// Render-once cache for 2D codes (D41.1, D42). The entry is built by src/lib/code-cache.ts (bwip-js through the engine)
// when a card is saved, imported or seeded, and written in the SAME transaction as the card row (createCard/updateCard
// take it as `codeCache`); the card screen only reads it. 1D codes are not cached: they render in ≤ 1.3 ms on Hermes (S4).
import { withRead, withTransaction } from './tx';
import type { Db } from './types';

export type CodeCacheEntry = {
  /** `v<CODE_CACHE_VERSION>` + U+001F + format + U+001F + the value drawn (codeOf(card)); a different key = stale. */
  key: string;
  modulesWide: number;
  modulesHigh: number;
  /** SVG path data in MODULE units (quiet zone included): one `M x y h w v 1 h -w z` per run of dark modules. */
  path: string;
};

/**
 * Bumped whenever the engine draws a 2D code differently, so every stored render becomes stale and is rebuilt (the
 * start-up background fill, or the card screen on a miss). 2 = D46 (Aztec 33 % error correction, 4-module quiet zone);
 * entries from P6 carry no version and are stale.
 */
export const CODE_CACHE_VERSION = 2;

export const codeKey = (format: string, value: string): string => `v${CODE_CACHE_VERSION}\u001f${format}\u001f${value}`;

type Row = { code_key: string; modules_wide: number; modules_high: number; path: string };

/** Inside an open transaction: replaces the card's entry (null removes it). */
export async function writeCodeCache(tx: Db, cardId: string, entry: CodeCacheEntry | null, now: number): Promise<void> {
  await tx.runAsync('DELETE FROM code_cache WHERE card_id = ?', cardId);
  if (entry) await tx.runAsync('INSERT INTO code_cache (card_id, code_key, modules_wide, modules_high, path, created_at) VALUES (?, ?, ?, ?, ?, ?)', cardId, entry.key, entry.modulesWide, entry.modulesHigh, entry.path, now);
}

export async function getCodeCache(db: Db, cardId: string): Promise<CodeCacheEntry | null> {
  const row = await withRead(db, (r) => r.getFirstAsync<Row>('SELECT code_key, modules_wide, modules_high, path FROM code_cache WHERE card_id = ?', cardId));
  return row ? { key: row.code_key, modulesWide: row.modules_wide, modulesHigh: row.modules_high, path: row.path } : null;
}

/** Stores an entry for an existing card on its own (background fill, stale repair). */
export function putCodeCache(db: Db, cardId: string, entry: CodeCacheEntry, now = Date.now()): Promise<void> {
  return withTransaction(db, async (tx) => {
    const card = await tx.getFirstAsync<{ id: string }>('SELECT id FROM cards WHERE id = ?', cardId);
    if (card) await writeCodeCache(tx, cardId, entry, now);
  });
}

/** Cards (live or in the undo window) with a 2D format whose entry is missing or stale: the background fill's work list. */
export async function cardsNeedingCodeCache(db: Db): Promise<{ id: string; key: string }[]> {
  const rows = await withRead(db, (r) =>
    r.getAllAsync<{ id: string; format: string; number: string; code_value: string; code_key: string | null }>(
      `SELECT c.id, c.format, c.number, c.code_value, k.code_key FROM cards c LEFT JOIN code_cache k ON k.card_id = c.id
       WHERE c.format IN ('qr','aztec','pdf417','datamatrix') ORDER BY c.last_used_at DESC, c.sort_index`
    )
  );
  return rows
    .map((r) => ({ id: r.id, key: codeKey(r.format, r.code_value !== '' ? r.code_value : r.number), cached: r.code_key }))
    .filter((r) => r.cached !== r.key)
    .map(({ id, key }) => ({ id, key }));
}

// Cards (SPEC §4.2). Writes in one transaction each (template rules), reads through withRead.
// Files-then-rows (SPEC §4.1): photo files are already at their final paths when createCard runs (src/lib/files.ts moves
// them first); rows are removed for good BEFORE their files (purgeDeleted returns what to remove).
// Delete = soft (`deleted_at`) with an 8-second undo window (D25); `purgeDeleted` removes rows older than the window.
// Import never overwrites an existing card (L26): the importer asks `findDuplicates` and skips or creates new rows.
import { isFormatId, type FormatId } from '@/engine/barcode/formats';
import { isCurrencyCode } from '@/engine/currency';
import { newId } from '@/lib/id';

import { writeCodeCache, type CodeCacheEntry } from './code-cache';
import { withRead, withTransaction } from './tx';
import type { Db } from './types';

export type Tile = 'initials' | 'photo';
export type ArchivedFilter = 'exclude' | 'only' | 'all';
/** Undo window for a deleted card (SPEC §9). */
export const UNDO_WINDOW_MS = 8_000;
export const NAME_MAX = 80;
export const COLOR_RE = /^#[0-9a-f]{6}$/;

export type NewCard = {
  id?: string;
  name: string;
  number?: string;
  /** Barcode content when it differs from the printed number; '' = same as number. */
  codeValue?: string;
  format: FormatId;
  color: string;
  tile?: Tile;
  chainId?: string | null;
  note?: string;
  balance?: string;
  balanceCurrency?: string;
  validFrom?: number | null;
  expiry?: number | null;
  favourite?: boolean;
  archived?: boolean;
  hasFront?: boolean;
  hasBack?: boolean;
  useCount?: number;
  lastUsedAt?: number | null;
  /** Manual position; default = after the last card. */
  sortIndex?: number;
  categoryIds?: readonly string[];
  /** Rendered 2D code (src/lib/code-cache.ts), written in the same transaction; null/absent = none (D42). */
  codeCache?: CodeCacheEntry | null;
};

export type CardPatch = Partial<Omit<NewCard, 'id'>>;

export type Card = {
  id: string;
  name: string;
  number: string;
  codeValue: string;
  format: FormatId;
  color: string;
  tile: Tile;
  chainId: string | null;
  note: string;
  balance: string;
  balanceCurrency: string;
  validFrom: number | null;
  expiry: number | null;
  favourite: boolean;
  archived: boolean;
  hasFront: boolean;
  hasBack: boolean;
  useCount: number;
  lastUsedAt: number | null;
  sortIndex: number;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
  categoryIds: string[];
};

type CardRow = {
  id: string;
  name: string;
  number: string;
  code_value: string;
  format: string;
  color: string;
  tile: Tile;
  chain_id: string | null;
  note: string;
  balance: string;
  balance_currency: string;
  valid_from: number | null;
  expiry: number | null;
  favourite: number;
  archived: number;
  has_front: number;
  has_back: number;
  use_count: number;
  last_used_at: number | null;
  sort_index: number;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
  category_ids: string | null;
};

const COLUMNS =
  'c.id, c.name, c.number, c.code_value, c.format, c.color, c.tile, c.chain_id, c.note, c.balance, c.balance_currency, c.valid_from, c.expiry, c.favourite, c.archived, c.has_front, c.has_back, c.use_count, c.last_used_at, c.sort_index, c.deleted_at, c.created_at, c.updated_at, ' +
  "(SELECT group_concat(cc.category_id, '\u001f') FROM card_categories cc WHERE cc.card_id = c.id) AS category_ids";

function toCard(r: CardRow): Card {
  if (!isFormatId(r.format)) throw new Error(`card ${r.id}: unknown format ${r.format}`);
  return {
    id: r.id,
    name: r.name,
    number: r.number,
    codeValue: r.code_value,
    format: r.format,
    color: r.color,
    tile: r.tile,
    chainId: r.chain_id,
    note: r.note,
    balance: r.balance,
    balanceCurrency: r.balance_currency,
    validFrom: r.valid_from,
    expiry: r.expiry,
    favourite: r.favourite === 1,
    archived: r.archived === 1,
    hasFront: r.has_front === 1,
    hasBack: r.has_back === 1,
    useCount: r.use_count,
    lastUsedAt: r.last_used_at,
    sortIndex: r.sort_index,
    deletedAt: r.deleted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    categoryIds: r.category_ids ? r.category_ids.split('\u001f').sort() : [],
  };
}

/** The value drawn as the barcode: `codeValue` when set, else the printed number. */
export function codeOf(card: Pick<Card, 'number' | 'codeValue'>): string {
  return card.codeValue !== '' ? card.codeValue : card.number;
}

/** Trims and checks the fields the CHECK constraints would reject, with readable messages (never auto-corrects a value). */
export function checkCardInput(input: Pick<NewCard, 'name' | 'format' | 'color' | 'balanceCurrency'>): void {
  const name = input.name.trim();
  const chars = [...name].length; // characters as SQLite's length() counts them, not UTF-16 units (review N4)
  if (chars < 1 || chars > NAME_MAX) throw new Error(`card name must be 1–${NAME_MAX} characters`);
  // '' = points; otherwise an ISO 4217 code Catima/Android accept (review M5: an unknown code aborts a Catima import)
  if (input.balanceCurrency !== undefined && input.balanceCurrency !== '' && !isCurrencyCode(input.balanceCurrency)) throw new Error(`currency must be an ISO 4217 code or empty, got ${input.balanceCurrency}`);
  if (!isFormatId(input.format)) throw new Error(`unknown format ${String(input.format)}`);
  if (!COLOR_RE.test(input.color)) throw new Error(`colour must be #rrggbb lower case, got ${input.color}`);
}

async function nextSortIndex(tx: Db): Promise<number> {
  const row = await tx.getFirstAsync<{ m: number | null }>('SELECT MAX(sort_index) AS m FROM cards');
  return (row?.m ?? -1) + 1;
}

async function insertCard(tx: Db, input: NewCard, now: number, sortIndex: number): Promise<string> {
  checkCardInput(input);
  const id = input.id ?? newId(now);
  await tx.runAsync(
    `INSERT INTO cards (id, name, number, code_value, format, color, tile, chain_id, note, balance, balance_currency, valid_from, expiry,
       favourite, archived, has_front, has_back, use_count, last_used_at, sort_index, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    id,
    input.name.trim(),
    input.number ?? '',
    input.codeValue ?? '',
    input.format,
    input.color,
    input.tile ?? 'initials',
    input.chainId ?? null,
    input.note ?? '',
    input.balance ?? '',
    input.balanceCurrency ?? '',
    input.validFrom ?? null,
    input.expiry ?? null,
    input.favourite ? 1 : 0,
    input.archived ? 1 : 0,
    input.hasFront ? 1 : 0,
    input.hasBack ? 1 : 0,
    input.useCount ?? 0,
    input.lastUsedAt ?? null,
    input.sortIndex ?? sortIndex,
    now,
    now
  );
  if (input.categoryIds?.length) await writeLinks(tx, id, input.categoryIds);
  if (input.codeCache) await writeCodeCache(tx, id, input.codeCache, now);
  return id;
}

async function writeLinks(tx: Db, cardId: string, categoryIds: readonly string[]): Promise<void> {
  await tx.runAsync('DELETE FROM card_categories WHERE card_id = ?', cardId);
  for (const c of new Set(categoryIds)) await tx.runAsync('INSERT INTO card_categories (card_id, category_id) VALUES (?, ?)', cardId, c);
}

/** One card in one transaction (files already moved, SPEC §4.1). Returns the id. */
export function createCard(db: Db, input: NewCard, now = Date.now()): Promise<string> {
  return withTransaction(db, async (tx) => insertCard(tx, input, now, await nextSortIndex(tx)));
}

/**
 * Many cards (import). Chunked transactions (SPEC §9: > 2,000 cards still import), so a bad row fails only its chunk;
 * returns the ids created and the rows rejected with the reason.
 */
export async function createCards(db: Db, inputs: readonly NewCard[], now = Date.now(), chunk = 200): Promise<{ ids: string[]; rejected: { index: number; reason: string }[] }> {
  const ids: string[] = [];
  const rejected: { index: number; reason: string }[] = [];
  for (let start = 0; start < inputs.length; start += chunk) {
    const slice = inputs.slice(start, start + chunk);
    // first try the chunk as one transaction; if one row breaks it, insert the rows one by one and report the bad ones
    try {
      ids.push(
        ...(await withTransaction(db, async (tx) => {
          let next = await nextSortIndex(tx);
          const out: string[] = [];
          for (const input of slice) out.push(await insertCard(tx, input, now, next++));
          return out;
        }))
      );
    } catch {
      for (let i = 0; i < slice.length; i++) {
        try {
          ids.push(await createCard(db, slice[i], now));
        } catch (e) {
          rejected.push({ index: start + i, reason: e instanceof Error ? e.message : String(e) });
        }
      }
    }
  }
  return { ids, rejected };
}

const PATCH_COLUMNS: Record<keyof Omit<CardPatch, 'categoryIds' | 'codeCache'>, string> = {
  name: 'name',
  number: 'number',
  codeValue: 'code_value',
  format: 'format',
  color: 'color',
  tile: 'tile',
  chainId: 'chain_id',
  note: 'note',
  balance: 'balance',
  balanceCurrency: 'balance_currency',
  validFrom: 'valid_from',
  expiry: 'expiry',
  favourite: 'favourite',
  archived: 'archived',
  hasFront: 'has_front',
  hasBack: 'has_back',
  useCount: 'use_count',
  lastUsedAt: 'last_used_at',
  sortIndex: 'sort_index',
};

/** Changes the given fields of a live or deleted card. Throws when the card does not exist. */
export async function updateCard(db: Db, id: string, patch: CardPatch, now = Date.now()): Promise<void> {
  await withTransaction(db, async (tx) => {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [key, column] of Object.entries(PATCH_COLUMNS) as [keyof typeof PATCH_COLUMNS, string][]) {
      if (!(key in patch)) continue;
      const v = patch[key];
      if (key === 'name') {
        checkCardInput({ name: String(v), format: 'none', color: '#000000' });
        values.push(String(v).trim());
      } else if (key === 'format') {
        checkCardInput({ name: 'x', format: v as FormatId, color: '#000000' });
        values.push(v as string);
      } else if (key === 'balanceCurrency') {
        checkCardInput({ name: 'x', format: 'none', color: '#000000', balanceCurrency: String(v ?? '') });
        values.push(String(v ?? ''));
      } else if (key === 'color') {
        checkCardInput({ name: 'x', format: 'none', color: String(v) });
        values.push(String(v));
      } else if (typeof v === 'boolean') values.push(v ? 1 : 0);
      else values.push(v === undefined ? null : (v as string | number | null));
      sets.push(`${column} = ?`);
    }
    if (sets.length) {
      sets.push('updated_at = ?');
      values.push(now);
      const result = await tx.runAsync(`UPDATE cards SET ${sets.join(', ')} WHERE id = ?`, ...values, id);
      if (result.changes === 0) throw new Error(`card ${id} not found`);
    } else {
      const row = await tx.getFirstAsync<{ id: string }>('SELECT id FROM cards WHERE id = ?', id);
      if (!row) throw new Error(`card ${id} not found`);
    }
    if (patch.categoryIds) await writeLinks(tx, id, patch.categoryIds);
    // a patch that names `codeCache` replaces it (null removes a stale one when the code became 1D or number only)
    if ('codeCache' in patch) await writeCodeCache(tx, id, patch.codeCache ?? null, now);
  });
}

export async function getCard(db: Db, id: string): Promise<Card | null> {
  const row = await withRead(db, (r) => r.getFirstAsync<CardRow>(`SELECT ${COLUMNS} FROM cards c WHERE c.id = ?`, id));
  return row ? toCard(row) : null;
}

/** Live cards in manual order (sort.ts in the engine applies the other modes). */
export async function listCards(db: Db, archived: ArchivedFilter = 'exclude'): Promise<Card[]> {
  const where = archived === 'all' ? '' : archived === 'only' ? ' AND c.archived = 1' : ' AND c.archived = 0';
  const rows = await withRead(db, (r) => r.getAllAsync<CardRow>(`SELECT ${COLUMNS} FROM cards c WHERE c.deleted_at IS NULL${where} ORDER BY c.sort_index, c.created_at, c.id`));
  return rows.map(toCard);
}

/** Cards in the undo window (deleted, not yet purged). */
export async function listDeleted(db: Db): Promise<Card[]> {
  const rows = await withRead(db, (r) => r.getAllAsync<CardRow>(`SELECT ${COLUMNS} FROM cards c WHERE c.deleted_at IS NOT NULL ORDER BY c.deleted_at DESC`));
  return rows.map(toCard);
}

export async function countCards(db: Db): Promise<number> {
  const row = await withRead(db, (r) => r.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM cards WHERE deleted_at IS NULL'));
  return row?.n ?? 0;
}

/** Anything `wipeAllCards` would delete (cards incl. archived and in the undo window, categories). */
export async function hasWipeableData(db: Db): Promise<boolean> {
  const row = await withRead(db, (r) => r.getFirstAsync<{ n: number }>('SELECT (SELECT COUNT(*) FROM cards) + (SELECT COUNT(*) FROM categories) AS n'));
  return (row?.n ?? 0) > 0;
}

/** The card was shown at a till: use_count + 1, last_used_at = now (most-used sort, shortcuts, widgets). */
export async function recordUse(db: Db, id: string, now = Date.now()): Promise<void> {
  await withTransaction(db, async (tx) => {
    await tx.runAsync('UPDATE cards SET use_count = use_count + 1, last_used_at = ? WHERE id = ? AND deleted_at IS NULL', now, id);
  });
}

export function setFavourite(db: Db, id: string, favourite: boolean, now = Date.now()): Promise<void> {
  return updateCard(db, id, { favourite }, now);
}

export function setArchived(db: Db, id: string, archived: boolean, now = Date.now()): Promise<void> {
  return updateCard(db, id, { archived }, now);
}

/** Soft delete: the rows and files stay for the undo window. */
export async function deleteCards(db: Db, ids: readonly string[], now = Date.now()): Promise<void> {
  if (ids.length === 0) return;
  await withTransaction(db, async (tx) => {
    for (const id of ids) await tx.runAsync('UPDATE cards SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', now, now, id);
  });
}

/** Undo within the window: the card comes back exactly as it was (same position, photos, categories). */
export async function undoDelete(db: Db, ids: readonly string[], now = Date.now()): Promise<number> {
  if (ids.length === 0) return 0;
  return withTransaction(db, async (tx) => {
    let n = 0;
    for (const id of ids) n += (await tx.runAsync('UPDATE cards SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL', now, id)).changes;
    return n;
  });
}

export type Purged = { id: string; hasFront: boolean; hasBack: boolean };

/**
 * Removes rows deleted before `before` (default: older than the undo window) FOR GOOD and returns which cards had
 * photos, so the caller removes the files afterwards (rows first, files after: a crash in between leaves a folder the
 * start-up sweep removes, never a row without files).
 */
export async function purgeDeleted(db: Db, now = Date.now(), before = now - UNDO_WINDOW_MS, ids?: readonly string[]): Promise<Purged[]> {
  return withTransaction(db, async (tx) => {
    const rows = ids
      ? await tx.getAllAsync<{ id: string; has_front: number; has_back: number }>(`SELECT id, has_front, has_back FROM cards WHERE deleted_at IS NOT NULL AND id IN (${ids.map(() => '?').join(',')})`, ...ids)
      : await tx.getAllAsync<{ id: string; has_front: number; has_back: number }>('SELECT id, has_front, has_back FROM cards WHERE deleted_at IS NOT NULL AND deleted_at <= ?', before);
    for (const r of rows) await tx.runAsync('DELETE FROM cards WHERE id = ?', r.id);
    return rows.map((r) => ({ id: r.id, hasFront: r.has_front === 1, hasBack: r.has_back === 1 }));
  });
}

/** Manual order: moves one card to position `to` among the live cards (0-based, as shown with archived = 'all'). */
export async function moveCard(db: Db, id: string, to: number, now = Date.now()): Promise<void> {
  await withTransaction(db, async (tx) => {
    const rows = await tx.getAllAsync<{ id: string }>('SELECT id FROM cards WHERE deleted_at IS NULL ORDER BY sort_index, created_at, id');
    const ids = rows.map((r) => r.id);
    const from = ids.indexOf(id);
    if (from < 0) throw new Error(`card ${id} not found`);
    ids.splice(from, 1);
    ids.splice(Math.max(0, Math.min(to, ids.length)), 0, id);
    await applyOrder(tx, ids, now);
  });
}

/** Manual order from a full list (drag and drop result). Cards not listed keep their relative order after the listed ones. */
export async function setManualOrder(db: Db, ids: readonly string[], now = Date.now()): Promise<void> {
  await withTransaction(db, async (tx) => {
    const rows = await tx.getAllAsync<{ id: string }>('SELECT id FROM cards WHERE deleted_at IS NULL ORDER BY sort_index, created_at, id');
    const listed = new Set(ids);
    await applyOrder(tx, [...ids.filter((id) => rows.some((r) => r.id === id)), ...rows.map((r) => r.id).filter((id) => !listed.has(id))], now);
  });
}

async function applyOrder(tx: Db, ids: readonly string[], now: number): Promise<void> {
  for (let i = 0; i < ids.length; i++) await tx.runAsync('UPDATE cards SET sort_index = ?, updated_at = CASE WHEN sort_index = ? THEN updated_at ELSE ? END WHERE id = ?', i, i, now, ids[i]);
}

export function setCardCategories(db: Db, cardId: string, categoryIds: readonly string[], now = Date.now()): Promise<void> {
  return updateCard(db, cardId, { categoryIds }, now);
}

/** Import duplicate rule (SPEC §9): same number + format among live cards. Returns the ids of the matching cards. */
export async function findDuplicates(db: Db, number: string, format: FormatId): Promise<string[]> {
  const rows = await withRead(db, (r) => r.getAllAsync<{ id: string }>('SELECT id FROM cards WHERE deleted_at IS NULL AND number = ? AND format = ?', number, format));
  return rows.map((r) => r.id);
}

/** Every card id that has a row (live or in the undo window): the start-up sweep keeps exactly these folders. */
export async function allCardIds(db: Db): Promise<string[]> {
  const rows = await withRead(db, (r) => r.getAllAsync<{ id: string }>('SELECT id FROM cards'));
  return rows.map((r) => r.id);
}

/** Development seed only: removes every card, category and link. Returns the purged photo flags for the file sweep. */
export async function wipeAllCards(db: Db): Promise<Purged[]> {
  return withTransaction(db, async (tx) => {
    const rows = await tx.getAllAsync<{ id: string; has_front: number; has_back: number }>('SELECT id, has_front, has_back FROM cards');
    await tx.execAsync('DELETE FROM card_categories; DELETE FROM cards; DELETE FROM categories;');
    return rows.map((r) => ({ id: r.id, hasFront: r.has_front === 1, hasBack: r.has_back === 1 }));
  });
}

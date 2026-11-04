// Categories (Catima "groups", SPEC §4.2). Names are unique case-insensitively (D25); links live in card_categories.
import { newId } from '@/lib/id';

import { withRead, withTransaction } from './tx';
import type { Db } from './types';

export const CATEGORY_NAME_MAX = 40;

export type Category = { id: string; name: string; sortIndex: number; createdAt: number; cardCount: number };

type Row = { id: string; name: string; sort_index: number; created_at: number; card_count: number };

const SELECT = `SELECT g.id, g.name, g.sort_index, g.created_at,
  (SELECT COUNT(*) FROM card_categories cc JOIN cards c ON c.id = cc.card_id WHERE cc.category_id = g.id AND c.deleted_at IS NULL) AS card_count
  FROM categories g`;

const toCategory = (r: Row): Category => ({ id: r.id, name: r.name, sortIndex: r.sort_index, createdAt: r.created_at, cardCount: r.card_count });

export function cleanCategoryName(name: string): string {
  const n = name.trim().replace(/\s+/g, ' ');
  const len = [...n].length; // code points, like the CHECK's SQLite length() (D39)
  if (len < 1 || len > CATEGORY_NAME_MAX) throw new Error(`category name must be 1–${CATEGORY_NAME_MAX} characters`);
  return n;
}

export async function listCategories(db: Db): Promise<Category[]> {
  const rows = await withRead(db, (r) => r.getAllAsync<Row>(`${SELECT} ORDER BY g.sort_index, g.created_at, g.id`));
  return rows.map(toCategory);
}

export async function getCategory(db: Db, id: string): Promise<Category | null> {
  const row = await withRead(db, (r) => r.getFirstAsync<Row>(`${SELECT} WHERE g.id = ?`, id));
  return row ? toCategory(row) : null;
}

/** Creates a category; a name that exists (any case) throws. */
export function createCategory(db: Db, name: string, now = Date.now(), id = newId(now)): Promise<string> {
  return withTransaction(db, async (tx) => {
    const clean = cleanCategoryName(name);
    const row = await tx.getFirstAsync<{ m: number | null }>('SELECT MAX(sort_index) AS m FROM categories');
    await tx.runAsync('INSERT INTO categories (id, name, sort_index, created_at) VALUES (?, ?, ?, ?)', id, clean, (row?.m ?? -1) + 1, now);
    return id;
  });
}

/** Import helper: the id of the category with this name (any case), created when missing. */
export function getOrCreateCategory(db: Db, name: string, now = Date.now()): Promise<string> {
  return withTransaction(db, async (tx) => {
    const clean = cleanCategoryName(name);
    const row = await tx.getFirstAsync<{ id: string }>('SELECT id FROM categories WHERE name = ? COLLATE NOCASE', clean);
    if (row) return row.id;
    const id = newId(now);
    const max = await tx.getFirstAsync<{ m: number | null }>('SELECT MAX(sort_index) AS m FROM categories');
    await tx.runAsync('INSERT INTO categories (id, name, sort_index, created_at) VALUES (?, ?, ?, ?)', id, clean, (max?.m ?? -1) + 1, now);
    return id;
  });
}

export async function renameCategory(db: Db, id: string, name: string): Promise<void> {
  await withTransaction(db, async (tx) => {
    const result = await tx.runAsync('UPDATE categories SET name = ? WHERE id = ?', cleanCategoryName(name), id);
    if (result.changes === 0) throw new Error(`category ${id} not found`);
  });
}

/** Removes the category; its cards stay (links cascade). */
export async function deleteCategory(db: Db, id: string): Promise<void> {
  await withTransaction(db, async (tx) => {
    await tx.runAsync('DELETE FROM categories WHERE id = ?', id);
  });
}

export async function setCategoryOrder(db: Db, ids: readonly string[]): Promise<void> {
  await withTransaction(db, async (tx) => {
    const rows = await tx.getAllAsync<{ id: string }>('SELECT id FROM categories ORDER BY sort_index, created_at, id');
    const listed = new Set(ids);
    const order = [...ids.filter((id) => rows.some((r) => r.id === id)), ...rows.map((r) => r.id).filter((id) => !listed.has(id))];
    for (let i = 0; i < order.length; i++) await tx.runAsync('UPDATE categories SET sort_index = ? WHERE id = ?', i, order[i]);
  });
}

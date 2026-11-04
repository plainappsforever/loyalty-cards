import { withTransaction } from './tx';
import type { Db } from './types';

// Append-only. Never edit a migration that has shipped; add a new one instead.
//
// FOREIGN-KEY TRAP (card-scanner review S14): the app opens the database with `PRAGMA foreign_keys = ON`, and every
// migration runs inside a transaction, where that pragma cannot be switched off. Rebuilding a PARENT table (CREATE new
// → copy → DROP old → RENAME) fires its ON DELETE actions on the child rows (`card_categories`). To change `cards` or
// `categories`, use ALTER TABLE … ADD COLUMN / RENAME COLUMN, or rebuild the child table instead.
export const MIGRATIONS: string[] = [
  `CREATE TABLE items (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT NOT NULL,
     note TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL
   );
   CREATE TABLE settings (
     key TEXT PRIMARY KEY NOT NULL,
     value TEXT NOT NULL
   );`,
  // 2 — loyalty card wallet (SPEC §4.2, P1). The template's demo table `items` stays until P6 repurposes its screens
  // (card-scanner D26: files are repurposed, never deleted); a later migration drops it. `deleted_at` (not in the SPEC
  // table) carries the soft delete with the 8-second undo window (D25). `settings` exists since migration 1.
  `CREATE TABLE cards (
     id TEXT PRIMARY KEY NOT NULL,
     name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
     number TEXT NOT NULL DEFAULT '',
     code_value TEXT NOT NULL DEFAULT '',
     format TEXT NOT NULL CHECK (format IN ('none','code128','ean13','ean8','upca','upce','itf','codabar','code39',
                                            'code93','qr','aztec','pdf417','datamatrix')),
     color TEXT NOT NULL CHECK (color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
     tile TEXT NOT NULL DEFAULT 'initials' CHECK (tile IN ('initials','photo')),
     chain_id TEXT NULL,
     note TEXT NOT NULL DEFAULT '',
     balance TEXT NOT NULL DEFAULT '',
     balance_currency TEXT NOT NULL DEFAULT '',
     valid_from INTEGER NULL,
     expiry INTEGER NULL,
     favourite INTEGER NOT NULL DEFAULT 0 CHECK (favourite IN (0,1)),
     archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
     has_front INTEGER NOT NULL DEFAULT 0 CHECK (has_front IN (0,1)),
     has_back INTEGER NOT NULL DEFAULT 0 CHECK (has_back IN (0,1)),
     use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
     last_used_at INTEGER NULL,
     sort_index INTEGER NOT NULL DEFAULT 0,
     deleted_at INTEGER NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE categories (
     id TEXT PRIMARY KEY NOT NULL,
     name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 40),
     sort_index INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE card_categories (
     card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
     category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
     PRIMARY KEY (card_id, category_id)
   );
   CREATE INDEX cards_last_used ON cards(last_used_at);
   CREATE INDEX cards_name ON cards(name COLLATE NOCASE);
   CREATE INDEX cards_live ON cards(deleted_at, archived, sort_index);
   CREATE INDEX card_categories_category ON card_categories(category_id);`,
  // 3 — P6: the template demo table goes (its screens are repurposed); the 2D code of each card is rendered ONCE on save
  // and kept here (D41.1, D42): the module paths of the symbol in module units, so opening a card never encodes. A child
  // table (cascade on purge), so `listCards` never reads the large path text. `code_key` = format + U+001F + the drawn
  // value: a row whose key no longer matches the card is stale and re-rendered.
  `DROP TABLE IF EXISTS items;
   CREATE TABLE code_cache (
     card_id TEXT PRIMARY KEY NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
     code_key TEXT NOT NULL,
     modules_wide INTEGER NOT NULL CHECK (modules_wide > 0),
     modules_high INTEGER NOT NULL CHECK (modules_high > 0),
     path TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );`,
];

export const LATEST_VERSION = MIGRATIONS.length;

/** Tables a migration must never rebuild (see the trap above). The test suite checks every migration against it. */
export const PARENT_TABLES = ['cards', 'categories'] as const;

export function parentTableRebuilds(sql: string): string[] {
  return PARENT_TABLES.filter((t) => new RegExp(`DROP\\s+TABLE\\s+(IF\\s+EXISTS\\s+)?${t}\\b`, 'i').test(sql));
}

export async function migrate(db: Db, migrations: string[] = MIGRATIONS): Promise<void> {
  // The version is read INSIDE each unit: another JS handle on the same connection (e.g. a background task at a cold
  // start) may have migrated meanwhile, and a migration must never run twice. One transaction per migration: a
  // failure rolls back both the schema change and user_version.
  for (;;) {
    const applied = await withTransaction(db, async (tx) => {
      const row = await tx.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      const version = row?.user_version ?? 0;
      if (version >= migrations.length) return false;
      const rebuilt = parentTableRebuilds(migrations[version]);
      if (rebuilt.length) throw new Error(`migration ${version + 1} rebuilds parent table(s) ${rebuilt.join(', ')}: ON DELETE actions would fire`);
      await tx.execAsync(`${migrations[version]} PRAGMA user_version = ${version + 1};`);
      return true;
    });
    if (!applied) return;
  }
}

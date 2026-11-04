/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';

import {
  codeOf,
  countCards,
  createCard,
  createCards,
  deleteCards,
  findDuplicates,
  getCard,
  listCards,
  listDeleted,
  moveCard,
  purgeDeleted,
  recordUse,
  setArchived,
  setFavourite,
  setManualOrder,
  undoDelete,
  updateCard,
  UNDO_WINDOW_MS,
  wipeAllCards,
} from './cards';
import { createCategory, deleteCategory, getOrCreateCategory, listCategories, renameCategory, setCategoryOrder } from './categories';
import { cardsNeedingCodeCache, codeKey, getCodeCache, putCodeCache } from './code-cache';
import { LATEST_VERSION, migrate, MIGRATIONS, parentTableRebuilds } from './migrations';
import { DEFAULT_SETTINGS, getSettings, getThemePreference, parseSetting, setSetting, setThemePreference, updateSetting } from './settings';

async function freshDb() {
  const db = createTestDb();
  await migrate(db);
  return db;
}

const base = { name: 'Nordmarkt', number: '4006381333931', format: 'ean13' as const, color: '#1f6f43' };

describe('migrations', () => {
  it('reaches the latest version (3) and is safe to run again', async () => {
    const db = await freshDb();
    await migrate(db);
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(LATEST_VERSION);
    expect(LATEST_VERSION).toBe(3);
  });

  it('no migration rebuilds a parent table (ON DELETE actions would fire inside the transaction)', () => {
    for (const m of MIGRATIONS) expect(parentTableRebuilds(m)).toEqual([]);
    expect(parentTableRebuilds('DROP TABLE cards;')).toEqual(['cards']);
  });

  it('refuses to run a migration that drops a parent table', async () => {
    const db = createTestDb();
    await expect(migrate(db, [...MIGRATIONS, 'DROP TABLE categories;'])).rejects.toThrow('rebuilds parent table');
  });

  it('enforces the CHECK rules of SPEC §4.2', async () => {
    const db = await freshDb();
    await expect(createCard(db, { ...base, name: '' })).rejects.toThrow('card name');
    await expect(createCard(db, { ...base, name: 'x'.repeat(81) })).rejects.toThrow('card name');
    await expect(createCard(db, { ...base, color: '#ABCDEF' })).rejects.toThrow('colour');
    await expect(createCard(db, { ...base, format: 'maxicode' as never })).rejects.toThrow('unknown format');
    await expect(db.runAsync("INSERT INTO cards (id, name, format, color, created_at, updated_at) VALUES ('x', 'n', 'rss14', '#000000', 1, 1)")).rejects.toThrow();
    expect(await countCards(db)).toBe(0);
  });

  it('migration 3 drops the template items table (P6) and keeps existing cards', async () => {
    const db = createTestDb();
    await migrate(db, MIGRATIONS.slice(0, 2));
    await db.runAsync("INSERT INTO items (title, note, created_at) VALUES ('old', '', 1)");
    await createCard(db, base, 1000);
    await migrate(db);
    expect(await db.getFirstAsync("SELECT name FROM sqlite_master WHERE name = 'items'")).toBeNull();
    expect((await listCards(db)).map((c) => c.name)).toEqual(['Nordmarkt']);
  });
});

describe('code cache (D42, render once on save)', () => {
  const entry = { key: codeKey('qr', 'CARD-1'), modulesWide: 29, modulesHigh: 29, path: 'M0 0h7v1h-7z' };
  const qr = { ...base, name: 'Kaffeehaus', number: 'CARD-1', format: 'qr' as const };

  it('is written with the card, replaced or removed by a patch, cascades on purge', async () => {
    const db = await freshDb();
    const id = await createCard(db, { ...qr, codeCache: entry }, 1000);
    expect(await getCodeCache(db, id)).toEqual(entry);
    expect(await cardsNeedingCodeCache(db)).toEqual([]);
    await updateCard(db, id, { number: 'CARD-2' }, 2000); // stale now
    expect(await cardsNeedingCodeCache(db)).toEqual([{ id, key: codeKey('qr', 'CARD-2') }]);
    await updateCard(db, id, { codeCache: { ...entry, key: codeKey('qr', 'CARD-2') } }, 3000);
    expect(await cardsNeedingCodeCache(db)).toEqual([]);
    await updateCard(db, id, { format: 'code128', codeCache: null }, 4000);
    expect(await getCodeCache(db, id)).toBeNull();
    await updateCard(db, id, { format: 'qr' }, 5000);
    await putCodeCache(db, id, { ...entry, key: codeKey('qr', 'CARD-2') });
    await deleteCards(db, [id], 6000);
    await purgeDeleted(db, 6000 + UNDO_WINDOW_MS + 1);
    expect(await db.getFirstAsync('SELECT COUNT(*) AS n FROM code_cache')).toEqual({ n: 0 });
  });

  it('a failed card insert leaves no cache row; 1D cards never need one; putCodeCache ignores a missing card', async () => {
    const db = await freshDb();
    await expect(createCard(db, { ...qr, name: '', codeCache: entry })).rejects.toThrow('card name');
    await createCard(db, base, 1000);
    await putCodeCache(db, 'nope', entry);
    expect(await db.getFirstAsync('SELECT COUNT(*) AS n FROM code_cache')).toEqual({ n: 0 });
    expect(await cardsNeedingCodeCache(db)).toEqual([]);
  });

  it('a render stored before the version bump (P6 key without a version) is stale and rebuilt (D46)', async () => {
    const db = await freshDb();
    const id = await createCard(db, { ...qr, codeCache: { ...entry, key: 'qr\u001fCARD-1' } }, 1000);
    expect(codeKey('qr', 'CARD-1')).toBe('v2\u001fqr\u001fCARD-1');
    expect(await cardsNeedingCodeCache(db)).toEqual([{ id, key: codeKey('qr', 'CARD-1') }]);
    await putCodeCache(db, id, entry);
    expect(await cardsNeedingCodeCache(db)).toEqual([]);
  });
});

describe('cards', () => {
  it('creates, reads and updates a card with every column', async () => {
    const db = await freshDb();
    const id = await createCard(db, { ...base, id: 'c1', codeValue: '', note: 'line 1\nline 2', balance: '12.50', balanceCurrency: 'EUR', expiry: 5000, chainId: 'de-nordmarkt' }, 1000);
    expect(id).toBe('c1');
    const card = await getCard(db, 'c1');
    expect(card).toMatchObject({ id: 'c1', name: 'Nordmarkt', number: '4006381333931', codeValue: '', format: 'ean13', color: '#1f6f43', tile: 'initials', chainId: 'de-nordmarkt', note: 'line 1\nline 2', balance: '12.50', balanceCurrency: 'EUR', validFrom: null, expiry: 5000, favourite: false, archived: false, hasFront: false, hasBack: false, useCount: 0, lastUsedAt: null, sortIndex: 0, deletedAt: null, createdAt: 1000, updatedAt: 1000, categoryIds: [] });
    expect(codeOf(card!)).toBe('4006381333931');

    await updateCard(db, 'c1', { name: '  Nordmarkt Plus ', codeValue: 'ABC', format: 'code128', tile: 'photo', hasFront: true, favourite: true, expiry: null }, 2000);
    const after = await getCard(db, 'c1');
    expect(after).toMatchObject({ name: 'Nordmarkt Plus', codeValue: 'ABC', format: 'code128', tile: 'photo', hasFront: true, favourite: true, expiry: null, updatedAt: 2000 });
    expect(codeOf(after!)).toBe('ABC');
    await expect(updateCard(db, 'missing', { name: 'x' })).rejects.toThrow('not found');
    await expect(updateCard(db, 'c1', { color: 'red' })).rejects.toThrow('colour');
    expect((await getCard(db, 'c1'))?.color).toBe('#1f6f43'); // the failed update changed nothing
  });

  it('lists live cards in manual order, archived filtered', async () => {
    const db = await freshDb();
    await createCard(db, { ...base, id: 'a', name: 'A' }, 1);
    await createCard(db, { ...base, id: 'b', name: 'B' }, 2);
    await createCard(db, { ...base, id: 'c', name: 'C', archived: true }, 3);
    expect((await listCards(db)).map((c) => c.id)).toEqual(['a', 'b']);
    expect((await listCards(db, 'only')).map((c) => c.id)).toEqual(['c']);
    expect((await listCards(db, 'all')).map((c) => c.id)).toEqual(['a', 'b', 'c']);
    await setArchived(db, 'a', true);
    expect((await listCards(db)).map((c) => c.id)).toEqual(['b']);
    await setFavourite(db, 'b', true);
    expect((await getCard(db, 'b'))?.favourite).toBe(true);
  });

  it('counts uses (most-used sort, shortcuts)', async () => {
    const db = await freshDb();
    await createCard(db, { ...base, id: 'a' }, 1);
    await recordUse(db, 'a', 500);
    await recordUse(db, 'a', 900);
    expect(await getCard(db, 'a')).toMatchObject({ useCount: 2, lastUsedAt: 900 });
  });

  it('soft delete → undo restores everything; purge after the window removes the row and reports the photo flags', async () => {
    const db = await freshDb();
    const g = await createCategory(db, 'Food', 1, 'g1');
    await createCard(db, { ...base, id: 'a', hasFront: true, categoryIds: [g] }, 1);
    await createCard(db, { ...base, id: 'b' }, 2);
    await deleteCards(db, ['a'], 1000);
    expect((await listCards(db)).map((c) => c.id)).toEqual(['b']);
    expect((await listDeleted(db)).map((c) => c.id)).toEqual(['a']);
    expect(await purgeDeleted(db, 1000 + UNDO_WINDOW_MS - 1)).toEqual([]); // still inside the window
    expect(await undoDelete(db, ['a'], 1500)).toBe(1);
    expect(await getCard(db, 'a')).toMatchObject({ deletedAt: null, categoryIds: ['g1'], hasFront: true, sortIndex: 0 });
    expect((await listCards(db)).map((c) => c.id)).toEqual(['a', 'b']);

    await deleteCards(db, ['a'], 2000);
    expect(await purgeDeleted(db, 2000 + UNDO_WINDOW_MS)).toEqual([{ id: 'a', hasFront: true, hasBack: false }]);
    expect(await getCard(db, 'a')).toBeNull();
    expect(await undoDelete(db, ['a'])).toBe(0);
    expect((await listCategories(db))[0].cardCount).toBe(0); // link cascaded
    expect(await db.getAllAsync('SELECT * FROM card_categories')).toEqual([]);
  });

  it('manual order: move and full reorder', async () => {
    const db = await freshDb();
    for (const id of ['a', 'b', 'c', 'd']) await createCard(db, { ...base, id }, 1);
    await moveCard(db, 'd', 0);
    expect((await listCards(db)).map((c) => c.id)).toEqual(['d', 'a', 'b', 'c']);
    await moveCard(db, 'd', 99);
    expect((await listCards(db)).map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
    await setManualOrder(db, ['c', 'a']);
    expect((await listCards(db)).map((c) => c.id)).toEqual(['c', 'a', 'b', 'd']);
    const e = await createCard(db, { ...base, id: 'e' }, 2);
    expect((await listCards(db)).map((c) => c.id)).toEqual(['c', 'a', 'b', 'd', e]); // new cards go last
  });

  it('bulk create is chunked and reports rejected rows without losing the good ones', async () => {
    const db = await freshDb();
    const inputs = Array.from({ length: 450 }, (_, i) => ({ ...base, id: `i${i}`, name: i === 123 ? '' : `Card ${i}` }));
    const { ids, rejected } = await createCards(db, inputs, 1, 200);
    expect(ids).toHaveLength(449);
    expect(rejected).toEqual([{ index: 123, reason: expect.stringContaining('card name') }]);
    expect(await countCards(db)).toBe(449);
    expect((await listCards(db)).map((c) => c.id).slice(0, 3)).toEqual(['i0', 'i1', 'i2']);
  });

  it('finds import duplicates by number + format among live cards only', async () => {
    const db = await freshDb();
    await createCard(db, { ...base, id: 'a' }, 1);
    await createCard(db, { ...base, id: 'b', format: 'code128' }, 1);
    expect(await findDuplicates(db, base.number, 'ean13')).toEqual(['a']);
    await deleteCards(db, ['a']);
    expect(await findDuplicates(db, base.number, 'ean13')).toEqual([]);
  });

  it('wipeAllCards (dev seed) clears cards, links and categories', async () => {
    const db = await freshDb();
    const g = await createCategory(db, 'Food', 1);
    await createCard(db, { ...base, id: 'a', hasBack: true, categoryIds: [g] }, 1);
    expect(await wipeAllCards(db)).toEqual([{ id: 'a', hasFront: false, hasBack: true }]);
    expect(await countCards(db)).toBe(0);
    expect(await listCategories(db)).toEqual([]);
  });
});

describe('categories', () => {
  it('creates, renames, orders, deletes; names unique ignoring case; cards keep their other links', async () => {
    const db = await freshDb();
    const food = await createCategory(db, ' Food ', 1, 'g1');
    const fuel = await createCategory(db, 'Fuel', 2, 'g2');
    await expect(createCategory(db, 'food', 3)).rejects.toThrow();
    expect(await getOrCreateCategory(db, 'FOOD')).toBe(food);
    const books = await getOrCreateCategory(db, 'Books', 4);
    await createCard(db, { ...base, id: 'a', categoryIds: [food, fuel] }, 5);
    expect((await listCategories(db)).map((c) => [c.name, c.cardCount])).toEqual([
      ['Food', 1],
      ['Fuel', 1],
      ['Books', 0],
    ]);
    await renameCategory(db, books, 'Reading');
    await setCategoryOrder(db, [books]);
    expect((await listCategories(db)).map((c) => c.name)).toEqual(['Reading', 'Food', 'Fuel']);
    await deleteCategory(db, fuel);
    expect((await getCard(db, 'a'))?.categoryIds).toEqual([food]);
    await expect(renameCategory(db, 'nope', 'x')).rejects.toThrow('not found');
  });
});

describe('settings', () => {
  it('defaults, typed round trip, invalid stored values fall back', async () => {
    const db = await freshDb();
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS);
    await updateSetting(db, 'brightnessBoost', false);
    await updateSetting(db, 'sort', 'most_used');
    await updateSetting(db, 'widgetCardIds', ['a', 'b']);
    await updateSetting(db, 'lastExportAt', 1234);
    await updateSetting(db, 'language', 'de');
    await updateSetting(db, 'defaultCountry', 'AT');
    await updateSetting(db, 'draftCard', '{"name":"x"}');
    expect(await getSettings(db)).toEqual({ ...DEFAULT_SETTINGS, brightnessBoost: false, sort: 'most_used', widgetCardIds: ['a', 'b'], lastExportAt: 1234, language: 'de', defaultCountry: 'AT', draftCard: '{"name":"x"}' });
    await updateSetting(db, 'draftCard', null);
    await setSetting(db, 'sort', 'sideways');
    await setSetting(db, 'widget_card_ids', '{not json');
    await setSetting(db, 'default_country', 'germany');
    const s = await getSettings(db);
    expect(s.draftCard).toBeNull();
    expect(s.sort).toBe('manual');
    expect(s.widgetCardIds).toEqual([]);
    expect(s.defaultCountry).toBe('');
    expect(parseSetting('keepAwake', 'maybe')).toBe(true);
  });

  it('theme preference (template) still works', async () => {
    const db = await freshDb();
    expect(await getThemePreference(db)).toBe('system');
    await setThemePreference(db, 'dark');
    expect(await getThemePreference(db)).toBe('dark');
    await db.runAsync("UPDATE settings SET value = 'purple' WHERE key = 'theme'");
    expect(await getThemePreference(db)).toBe('system');
  });
});

describe('P4c guards (independent review M5, N4)', () => {
  it('refuses a non-ISO currency on create and update; counts the name in characters like SQLite', async () => {
    const db = await freshDb();
    await expect(createCard(db, { ...base, id: 'p1', balanceCurrency: 'PTS' })).rejects.toThrow('ISO 4217');
    await createCard(db, { ...base, id: 'p2', balanceCurrency: 'EUR', name: '🙂'.repeat(41) });
    await expect(updateCard(db, 'p2', { balanceCurrency: 'ABC' })).rejects.toThrow('ISO 4217');
    await updateCard(db, 'p2', { balanceCurrency: '' });
    expect(await getCard(db, 'p2')).toMatchObject({ balanceCurrency: '', name: '🙂'.repeat(41) });
    await expect(createCard(db, { ...base, id: 'p3', name: '🙂'.repeat(81) })).rejects.toThrow('1–80');
  });
});

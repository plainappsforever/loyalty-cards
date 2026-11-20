/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';
import { createCards, listCards } from '@/db/cards';
import { migrate } from '@/db/migrations';
import { gs1Checks } from '@/engine/barcode/check-digit';
import { FORMAT_IDS } from '@/engine/barcode/formats';

import { validate } from '@/engine/barcode/validate';

import { seedCards, seedCount, SEED_SETS } from './seed';

describe('seed sets', () => {
  it('are deterministic, cover every format and insert without a rejected row', async () => {
    expect(seedCards('ten')).toEqual(seedCards('ten'));
    const cards = seedCards('two-hundred');
    expect(cards).toHaveLength(200);
    expect(new Set(cards.map((c) => c.format))).toEqual(new Set(FORMAT_IDS));
    for (const c of cards) if (c.format === 'ean13' || c.format === 'ean8' || c.format === 'upca') expect(gs1Checks(c.number!)).toBe(true);
    const db = createTestDb();
    await migrate(db);
    const { ids, rejected } = await createCards(db, cards);
    expect(rejected).toEqual([]);
    expect(ids).toHaveLength(200);
    expect((await listCards(db, 'all')).length).toBe(200);
    for (const set of SEED_SETS) expect(seedCards(set)).toHaveLength(seedCount(set));
  });
});

describe('store-demo seed set (store screenshots)', () => {
  const cards = seedCards('store-demo');
  it('has 8-10 valid, distinct, varied-colour cards, one favourite, nothing expired, no placeholder notes', () => {
    expect(cards.length).toBeGreaterThanOrEqual(8);
    expect(cards.length).toBeLessThanOrEqual(10);
    for (const c of cards) {
      if (c.format !== 'none') expect(validate(c.number!, c.format!)).toMatchObject({ ok: true });
      expect(c.expiry == null || c.expiry > Date.now()).toBe(true);
      expect(c.note ?? '').not.toMatch(/seed/i);
    }
    expect(cards.filter((c) => c.favourite)).toHaveLength(1);
    expect(seedCards('store-demo', undefined, 'de').map((c) => c.note)).not.toEqual(cards.map((c) => c.note)); // German notes for the DE shots
    expect(new Set(cards.map((c) => c.color)).size).toBe(cards.length);
    expect(new Set(cards.map((c) => c.name)).size).toBe(cards.length);
  });
});

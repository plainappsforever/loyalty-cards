/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';
import { createCards, listCards } from '@/db/cards';
import { migrate } from '@/db/migrations';
import { gs1Checks } from '@/engine/barcode/check-digit';
import { FORMAT_IDS } from '@/engine/barcode/formats';

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

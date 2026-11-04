/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';

import { createCard, hasWipeableData, wipeAllCards } from './cards';
import { createCategory } from './categories';
import { migrate } from './migrations';

// F5: the preview seed route asks before it wipes only when there is something to lose.
describe('hasWipeableData', () => {
  it('is false for a fresh database, true once a card or a category exists, false again after the wipe', async () => {
    const db = createTestDb();
    await migrate(db);
    expect(await hasWipeableData(db)).toBe(false);
    await createCategory(db, 'Food');
    expect(await hasWipeableData(db)).toBe(true);
    await wipeAllCards(db);
    expect(await hasWipeableData(db)).toBe(false);
    await createCard(db, { id: 'a', name: 'A', number: '1', format: 'none', color: '#1f6f43' });
    expect(await hasWipeableData(db)).toBe(true);
  });
});

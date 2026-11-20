/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';

import { createCard, recordUse } from '@/db/cards';
import { migrate } from '@/db/migrations';
import { getSetting } from '@/db/settings';

import { maybeAskForReview, REVIEW_AFTER_USES, REVIEW_KEY, shouldAskForReview, type ReviewDeps } from './review-prompt';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.1.0' } } }));
jest.mock('expo-store-review', () => ({ isAvailableAsync: jest.fn(), requestReview: jest.fn() }));

const base = { name: 'Nordmarkt', number: '4006381333931', format: 'ean13' as const, color: '#6e3fa3' };

async function dbWithUses(uses: number) {
  const db = createTestDb();
  await migrate(db);
  const a = await createCard(db, base, 1000);
  const b = await createCard(db, { ...base, name: 'Zweitkarte', number: '4006381333948' }, 1000);
  for (let i = 0; i < uses; i++) await recordUse(db, i % 2 ? b : a, 2000 + i);
  return db;
}

function deps(available = true): ReviewDeps & { request: jest.Mock } {
  return { version: '1.1.0', isAvailable: async () => available, request: jest.fn(async () => undefined) };
}

describe('shouldAskForReview', () => {
  it('needs five till uses and an unasked version', () => {
    expect(shouldAskForReview(REVIEW_AFTER_USES - 1, null, '1.1.0')).toBe(false);
    expect(shouldAskForReview(REVIEW_AFTER_USES, null, '1.1.0')).toBe(true);
    expect(shouldAskForReview(40, '1.1.0', '1.1.0')).toBe(false);
    expect(shouldAskForReview(40, '1.0.0', '1.1.0')).toBe(true);
    expect(shouldAskForReview(40, null, '')).toBe(false);
  });
});

describe('maybeAskForReview', () => {
  it('stays quiet before the fifth use, summed over all cards', async () => {
    const d = deps();
    expect(await maybeAskForReview(await dbWithUses(4), d)).toBe(false);
    expect(d.request).not.toHaveBeenCalled();
  });

  it('asks once per version and remembers it', async () => {
    const db = await dbWithUses(5);
    const d = deps();
    expect(await maybeAskForReview(db, d)).toBe(true);
    expect(await getSetting(db, REVIEW_KEY)).toBe('1.1.0');
    expect(await maybeAskForReview(db, d)).toBe(false);
    expect(d.request).toHaveBeenCalledTimes(1);
    // a later version may ask again
    expect(await maybeAskForReview(db, { ...d, version: '1.2.0' })).toBe(true);
  });

  it('does nothing when the system sheet is unavailable, and never throws', async () => {
    const db = await dbWithUses(9);
    expect(await maybeAskForReview(db, deps(false))).toBe(false);
    expect(await getSetting(db, REVIEW_KEY)).toBeNull();
    const broken = { ...deps(), request: jest.fn(async () => { throw new Error('no'); }) };
    expect(await maybeAskForReview(db, broken)).toBe(false);
  });

  it('is not part of an export: the settings table is not written by export.ts', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src = require('fs').readFileSync(require('path').join(__dirname, 'export.ts'), 'utf8') as string;
    expect(src).not.toMatch(/settings/i);
  });
});

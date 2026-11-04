import fs from 'fs';
import path from 'path';

import { isTestVariant, seedNeedsConfirmation, wipeConfirmed, WIPE_WORD } from './variant';

describe('isTestVariant (D54: fail closed)', () => {
  test('open only for development and preview', () => {
    expect(isTestVariant('development')).toBe(true);
    expect(isTestVariant('preview')).toBe(true);
  });

  test('production, unknown, missing or unreadable config is closed', () => {
    for (const v of ['production', 'Production', '', 'prod', undefined, null, 0, {}]) expect(isTestVariant(v)).toBe(false);
  });
});

describe('debug/seed never hard-deletes without a typed word in preview (F5)', () => {
  test('preview with data asks; empty preview, development and production do not (production never reaches it)', () => {
    expect(seedNeedsConfirmation('preview', true)).toBe(true);
    expect(seedNeedsConfirmation('preview', false)).toBe(false);
    expect(seedNeedsConfirmation('development', true)).toBe(false);
    expect(isTestVariant('production')).toBe(false); // seed.tsx returns null before any wipe
  });

  test('only the exact word confirms', () => {
    expect(wipeConfirmed(WIPE_WORD)).toBe(true);
    expect(wipeConfirmed(` ${WIPE_WORD} `)).toBe(true);
    for (const typed of ['', 'wipe', 'WIPE IT', 'yes', 'DELETE']) expect(wipeConfirmed(typed)).toBe(false);
  });

  test('seed.tsx wipes only behind the gate and the confirmation', () => {
    const src = fs.readFileSync(path.join(__dirname, '../app/debug/seed.tsx'), 'utf8');
    expect(src).toContain('testToolsEnabled()');
    expect(src).toContain('if (!dev) return null');
    // the only wipe call sits inside seed(), which is reached either after seedNeedsConfirmation said no or from the confirm button
    expect(src.match(/wipeAllCards\(db\)/g)).toHaveLength(1);
    expect(src.indexOf('seedNeedsConfirmation(')).toBeLessThan(src.indexOf('await seed();'));
    expect(src).toContain('disabled={!wipeConfirmed(typed)}');
  });
});

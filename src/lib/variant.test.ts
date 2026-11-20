import fs from 'fs';
import path from 'path';

import { debugReadoutsVisible, isTestVariant, STORE_SHOTS_KEY, seedNeedsConfirmation, wipeConfirmed, WIPE_WORD } from './variant';

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

describe('store-shots switch hides the debug read-outs (test builds only)', () => {
  test('read-outs show in preview/development, hide while store_shots=1, never show elsewhere', () => {
    expect(STORE_SHOTS_KEY).toBe('store_shots');
    for (const v of ['preview', 'development']) {
      expect(debugReadoutsVisible(v, null)).toBe(true);
      expect(debugReadoutsVisible(v, '0')).toBe(true);
      expect(debugReadoutsVisible(v, '1')).toBe(false);
    }
    for (const v of ['production', undefined, '', 'prod']) {
      expect(debugReadoutsVisible(v, null)).toBe(false);
      expect(debugReadoutsVisible(v, '1')).toBe(false);
    }
  });

  test('the seed route sets it only for store-demo and clears it otherwise; the screens read it', () => {
    const read = (f: string) => fs.readFileSync(path.join(__dirname, f), 'utf8');
    const seed = read('../app/debug/seed.tsx');
    expect(seed).toContain("set === 'store-demo'");
    expect(seed).toContain('STORE_SHOTS_KEY');
    expect(seed).toContain('deleteSetting(db, STORE_SHOTS_KEY)');
    expect(read('../app/card/[id]/index.tsx')).toContain('debugReadoutsVisible(');
    expect(read('../app/settings.tsx')).toContain('debugReadoutsVisible(');
  });
});

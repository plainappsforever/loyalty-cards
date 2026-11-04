/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { APP_ID, APP_NAME, ID_PREFIX } from './app';

describe('app constants', () => {
  it('match app.config.ts (the native side cannot import src/ at config time)', () => {
    const text = readFileSync(join(__dirname, '..', '..', 'app.config.ts'), 'utf8');
    expect(text).toContain(`const APP_NAME = '${APP_NAME}'`);
    expect(text).toContain(`const APP_ID = '${APP_ID}'`);
    expect(text).toContain(`const ID_PREFIX = '${ID_PREFIX}'`);
  });
  it('never carries a personal name', () => {
    for (const s of [APP_NAME, APP_ID, ID_PREFIX]) expect(s.toLowerCase()).not.toMatch(/tim/);
  });
});

/**
 * @jest-environment node
 */
// Review F8 (fix round 2026-10-26): every text field and switch of the Cards and Add/Edit screens has a screen-reader label
// (TalkBack / VoiceOver read it instead of "edit box"); the heading above a field is a separate element. A source check: it
// does not replace a TalkBack / VoiceOver run, which stays IMPLEMENTED BUT UNVERIFIED.
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', 'app', rel), 'utf8');

function tags(src: string, names: string[]): string[] {
  return [...src.matchAll(new RegExp(`<(?:${names.join('|')})\\b[\\s\\S]*?\\/>`, 'g'))].map((m) => m[0]);
}

describe('screen-reader labels', () => {
  test.each(['card/[id]/edit.tsx', 'index.tsx'])('%s: every TextInput and Switch has an accessibilityLabel', (file) => {
    const found = tags(read(file), ['TextInput', 'Switch']);
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((t) => !t.includes('accessibilityLabel'))).toEqual([]);
  });

  test('colour swatches, list tiles and the torch carry a label; the torch state is a state, not a glyph', () => {
    expect(read('card/[id]/edit.tsx')).toMatch(/testID=\{`color-\$\{i\}`\} accessibilityRole="button" accessibilityLabel=/);
    expect(read('index.tsx')).toMatch(/accessibilityLabel=\{card\.favourite \?/);
    expect(read('../components/poster.tsx')).toMatch(/accessibilityLabel=\{card\.favourite \?/);
    expect(read('add/scan.tsx')).toMatch(/accessibilityLabel=\{t\('scan\.torch'\)\} accessibilityState=\{\{ selected: torch \}\}/);
  });

  // Expo Router bundles everything under src/app as a route (require.context): a test file there breaks the Release bundle
  // ("Unable to resolve module fs", found by the Android rebuild verification 2026-10-26).
  test('no test file sits under src/app', () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    expect(walk(path.join(__dirname, '..', 'app')).filter((f) => /\.test\.[tj]sx?$/.test(f))).toEqual([]);
  });
});

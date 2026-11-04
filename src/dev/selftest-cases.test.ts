/**
 * @jest-environment node
 */
// The Hermes self-test compares against these constants; this pins that Node (the engine's test runtime) gives the same.
import { fold } from '@/engine/chains';
import { validate } from '@/engine/barcode/validate';
import { foldText } from '@/engine/search';
import { NAME_COLLATION } from '@/engine/sort';

import { HERMES_TEXT_CASES, SELFTEST_IMAGES } from './selftest-cases';

describe('self-test cases', () => {
  it.each(HERMES_TEXT_CASES.foldText)('foldText(%j) = %j in Node', (input, out) => expect(foldText(input)).toBe(out));
  it.each(HERMES_TEXT_CASES.fold)('fold(%j) = %j in Node', (input, out) => expect(fold(input)).toBe(out));
  it.each(HERMES_TEXT_CASES.collate)('Collator %s: %j vs %j → %d in Node', (locale, a, b, sign) =>
    expect(Math.sign(new Intl.Collator(locale, NAME_COLLATION).compare(a, b))).toBe(sign),
  );
  it('every fixture value is valid for its format (13 formats + the two-code screenshot)', () => {
    const formats = new Set(SELFTEST_IMAGES.flatMap((i) => i.codes.map((c) => c.format)));
    expect(formats.size).toBe(13);
    for (const img of SELFTEST_IMAGES) for (const c of img.codes) expect(validate(c.value, c.format)).toMatchObject({ ok: true, value: c.value });
  });
});

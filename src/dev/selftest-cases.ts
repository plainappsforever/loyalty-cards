// Self-test cases (A6, SPEC §12) shared by the fixture generator (scripts/make-selftest-images.mjs, Node) and the dev
// self-test route (src/app/debug/self-test.tsx, Hermes). One realistic loyalty-card value per stored format + one
// "screenshot" with two codes. The PNGs in test/fixtures/images/ are rendered by our engine at 4 px per module.
import type { FormatId } from '@/engine/barcode/formats';

/** `reportOnly`: printed with its result but not counted (a known decoder limit, the reason says which). */
export type SelfTestImage = { file: string; codes: { format: FormatId; value: string }[]; reportOnly?: string };

export const SELFTEST_CODES: readonly { format: FormatId; value: string }[] = [
  { format: 'code128', value: 'LOYALTY-2026-0042' },
  { format: 'ean13', value: '4006381333931' },
  { format: 'ean8', value: '96385074' },
  { format: 'upca', value: '036000291452' },
  { format: 'upce', value: '01234565' },
  { format: 'itf', value: '12345678901231' },
  { format: 'codabar', value: 'A21234567890123B' }, // library-card shape: 14 digits between start/stop
  { format: 'code39', value: 'CARD-12345' },
  { format: 'code93', value: 'MEMBER93' },
  { format: 'qr', value: 'Müller 日本 12345' },
  { format: 'aztec', value: 'AZTEC-CARD-778899' },
  { format: 'pdf417', value: 'PDF417 MEMBER 0042' },
  { format: 'datamatrix', value: 'DM-1234567890' },
];

export const SELFTEST_IMAGES: readonly SelfTestImage[] = [
  ...SELFTEST_CODES.map((c) => ({ file: `${c.format}.png`, codes: [c] })),
  // a phone-screenshot stand-in: a card's EAN-13 above a QR on one white canvas (A6 "a screenshot with two codes")
  { file: 'two-codes.png', codes: [{ format: 'ean13', value: '5901234123457' }, { format: 'qr', value: 'MEMBER 778-221' }] },
  // P5 finding: ML Kit (Android) read no Codabar with fewer than 6 data characters in the decode set; Vision reads it.
  { file: 'codabar-short.png', codes: [{ format: 'codabar', value: 'A40156B' }], reportOnly: 'ML Kit reads no Codabar with < 6 data characters (P5 R2, D41)' },
];

/** R10 (review): Hermes must fold and collate exactly like Node. Expected values computed in Node, pinned in Jest. */
export const HERMES_TEXT_CASES = {
  foldText: [
    ['Café Müller', 'cafe muller'],
    ['ÉCOLE  Straße', 'ecole  strasse'],
    ['Ångström Øre', 'angstrom øre'],
    ['日本ストア', '日本ストア'],
    // NFD splits the voiced mark off ガ (U+3099 is outside the stripped Latin range, so it stays): Hermes must decompose too
    ['ガスト', 'カ\u3099スト'],
    ['Ｆｕｌｌ ｗｉｄｔｈ', 'ｆｕｌｌ ｗｉｄｔｈ'],
  ],
  fold: [
    ['Café Müller', 'cafe muller'],
    ['dm-drogerie markt', 'dm drogerie markt'],
    ['H&M', 'h m'],
    ['Żabka', 'zabka'],
    ['Пятёрочка', 'пятерочка'],
    ['&', ''],
  ],
  // Intl.Collator(locale, NAME_COLLATION).compare(a, b) sign, as sortCards uses it (sensitivity 'accent', D45.2)
  collate: [
    ['de', 'Äpfel', 'Zebra', -1],
    ['de', 'card 2', 'card 10', -1],
    ['en', 'apple', 'Apple', 0],
    ['sv', 'Ö', 'Z', 1],
    ['de', 'Ö', 'Z', -1],
    ['de', 'Zurich', 'Zürich', -1],
    ['fr', 'Café', 'Cafe', 1],
  ],
} as const;

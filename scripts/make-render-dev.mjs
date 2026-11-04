#!/usr/bin/env node
// Writes the builder's DEVELOPMENT render set test/fixtures/render/dev/render-dev.json (SPEC §13: >= 10 per format,
// min/max lengths, odd charsets). Tuning only, never evidence. Usage: node --import ./scripts/node/ts-hooks.mjs scripts/make-render-dev.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expandUpcE, gs1CheckDigit } from '../src/engine/barcode/check-digit.ts';

const e = [];
const add = (format, value, note) => e.push(note ? { format, value, note } : { format, value });
const gs1 = (b) => b + gs1CheckDigit(b);
for (const b of ['400638133393', '978020137962', '000000000000', '999999999999', '590123412345', '123456789012', '880000000001', '020000000001', '471234567890', '500000000000', '301234567890', '400000000000']) add('ean13', gs1(b));
for (const b of ['9638507', '0000000', '9999999', '1234567', '5512345', '4000000', '2011111', '7777777', '1000000', '3141592', '8888888']) add('ean8', gs1(b));
for (const b of ['03600029145', '00000000000', '99999999999', '01234567890', '72527273070', '04210000526', '61414100036', '88888888888', '12345678901', '30000000000', '55555555555']) add('upca', gs1(b));
for (const b of ['0123456', '0000000', '1999999', '0000003', '0123454', '0999995', '1000000', '0555556', '0123457', '0765438', '1123459']) add('upce', b + gs1CheckDigit(expandUpcE(b + '0').slice(0, 11)));
for (const v of ['1234', '0000', '9999', '1234567890', '12345678901234', '00000000000000', '12121212121212', '1'.repeat(40), '0'.repeat(20), '9'.repeat(30), '4711', '98765432']) add('itf', v);
for (const v of ['A12345B', 'B9876C', 'C00D', 'D123-45A', 'A$100.00B', 'A1:2/3+4B', '12345', '1-2-3', 'A' + '7'.repeat(38) + 'B', 'C$$B', 'D/:A', 'A..B', 'A00B', 'B42C']) add('codabar', v);
for (const v of ['ABC-123', 'A', '0', 'HELLO WORLD', 'A.B/C+D%E', '$100', 'X'.repeat(48), '1234567890', 'LC-2026', 'Z Z', '-.-', '% %']) add('code39', v);
for (const v of ['ABC-123', 'A', '0', 'HELLO WORLD', 'A.B/C+D%E', '$100', 'X'.repeat(48), '1234567890', 'LC-2026', 'Z Z', '-.-', '% %']) add('code93', v);
for (const v of ['HELLO 123', 'a', '0', '1234567890', 'ABCDEFGHIJ', 'abcdefghij', 'Mixed Case 42', '!"#$%&\'()*+,-./', ':;<=>?@[\\]^_`{|}~', '12345678901234567890123456789012345678901234567890', 'x'.repeat(80), '0'.repeat(80), 'a1b2c3d4e5f6g7h8i9j0', 'inner  spaces  kept', 'FNC-not-a-fnc', '99991111']) add('code128', v);
const lc = 'LC1:{"n":"Nordmarkt","i":"4006381333931","f":"ean13","k":"#1f6f43"}';
for (const v of ['hello', 'x', 'Müller ☃ 日本 🙂', 'https://example.com/path?q=1&b=2', '0123456789', 'A'.repeat(100), 'ü'.repeat(200), '日本語テキスト'.repeat(10), 'x'.repeat(1000), lc, 'line1\nline2', 'tab\there']) add('qr', v);
for (const v of ['hello', 'x', 'Müller ☃ 日本', '0123456789', 'A'.repeat(100), 'ü'.repeat(100), 'x'.repeat(1000), lc, 'line1\nline2', 'symbols !@#%^&*()', 'ÄÖÜäöüß', '🙂🙂🙂', 'a^b ü', '^^', 'x^y']) add('aztec', v);
for (const v of ['hello', 'x', 'Müller ☃ 日本', '0123456789', 'A'.repeat(100), 'ü'.repeat(100), 'x'.repeat(1000), lc, 'line1\nline2', 'symbols !@#%^&*()', 'ÄÖÜäöüß', '0'.repeat(500), 'a^b ü', '^ECI000026 literal', 'x^y']) add('pdf417', v);
for (const v of ['hello', 'x', 'Müller ☃ 日本', '0123456789', 'A'.repeat(100), 'ü'.repeat(100), 'x'.repeat(1000), lc, 'line1\nline2', 'symbols !@#%^&*()', 'ÄÖÜäöüß', '🙂🙂🙂', 'a^b ü', '^^', 'é^ECI000026']) add('datamatrix', v);
const file = join(import.meta.dirname, '../test/fixtures/render/dev/render-dev.json');
writeFileSync(file, JSON.stringify(e, null, 1) + '\n');
const by = {};
for (const x of e) by[x.format] = (by[x.format] || 0) + 1;
console.log(e.length, JSON.stringify(by));

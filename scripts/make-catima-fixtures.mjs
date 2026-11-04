#!/usr/bin/env node
// Builds the builder's own Catima fixtures (test/fixtures/catima/dev/): a version-2 zip with images written by our writer
// from a 44-card set, plus the expected import summary. The hand-written version-1 CSV in the same folder is static.
// Usage: node --import ./scripts/node/ts-hooks.mjs scripts/make-catima-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderMatrix } from '../src/engine/barcode/render.ts';
import { toPng } from '../src/engine/barcode/png.ts';
import { writeCatimaZip } from '../src/engine/catima/writer.ts';

const root = join(import.meta.dirname, '..');
const dir = join(root, 'test/fixtures/catima/dev');
mkdirSync(dir, { recursive: true });
const NAMES = ['Nordmarkt', 'Kaffeehaus Lila', 'Çağdaş Market', 'Ηλεκτρονικά', 'Магазин Ромашка', 'मेरी दुकान', 'お店', '商店', '가게', 'Cửa hàng', 'متجر', 'Loja do João', 'Tienda Ñandú', 'Épicerie', 'Sklep Żółw', 'Bücherecke'];
const FORMATS = ['none', 'code128', 'ean13', 'ean8', 'upca', 'upce', 'itf', 'codabar', 'code39', 'code93', 'qr', 'aztec', 'pdf417', 'datamatrix'];
import { expandUpcE, gs1CheckDigit } from '../src/engine/barcode/check-digit.ts';
const pad = (i, n) => String(i).padStart(n, '0');
// unique per card: GS1 formats get a check digit computed over an i-dependent body
const value = (f, i) => (f === 'ean13' ? `40063813${pad(i, 4)}` + gs1CheckDigit(`40063813${pad(i, 4)}`) : f === 'ean8' ? `963${pad(i, 4)}` + gs1CheckDigit(`963${pad(i, 4)}`) : f === 'upca' ? `0360002${pad(i, 4)}` + gs1CheckDigit(`0360002${pad(i, 4)}`) : f === 'upce' ? `0${pad(i, 6)}` + gs1CheckDigit(expandUpcE(`0${pad(i, 6)}0`).slice(0, 11)) : f === 'itf' ? `12345678${pad(i, 2)}` : f === 'codabar' ? `A${1000 + i}B` : `${1000 + i}`);
const cards = [];
for (let i = 0; i < 44; i++) {
  const f = FORMATS[i % FORMATS.length];
  const png = f === 'none' ? undefined : toPng(renderMatrix(value(f, i), f), { modulePx: 3, barHeightPx: 90 }).png;
  cards.push({
    name: `${NAMES[i % NAMES.length]} ${i}`, number: value(f, i), codeValue: i % 5 === 0 && f !== 'none' ? '' : '', format: f,
    color: ['#1f6f43', '#000000', '#ffffff', '#e0a100', '#6b2fa0'][i % 5],
    note: i % 3 === 0 ? 'line one, with comma\nline "two" quoted\nline three' : i % 3 === 1 ? '' : 'plain note',
    balance: i % 4 === 0 ? '12.50' : '', balanceCurrency: i % 4 === 0 ? 'EUR' : '',
    validFrom: i % 6 === 0 ? 1700000000000 : null, expiry: i % 2 === 0 ? 1800000000000 + i * 1000 : null,
    favourite: i % 7 === 0, archived: i % 11 === 0, lastUsedAt: i % 2 === 0 ? 1750000000000 : null,
    categories: i % 3 === 0 ? ['Food', 'Travel'] : i % 3 === 1 ? ['Food'] : [],
    images: i % 8 === 0 && png ? { front: png } : undefined,
  });
}
// duplicates for the summary test (A13): card 3 appears twice; two rows will be invalid (empty name / empty number)
const withDupes = [...cards, { ...cards[3] }];
const { zip } = writeCatimaZip(withDupes);
writeFileSync(join(dir, 'sample-v2.zip'), zip);
writeFileSync(join(dir, 'sample-v2.expected.json'), JSON.stringify({ cards: withDupes.length, groups: ['Food', 'Travel'], imagesFront: cards.filter((c) => c.images).length, duplicatesInFile: 1, skipped: 0, formats: Object.fromEntries(FORMATS.map((f) => [f, withDupes.filter((c) => c.format === f).length])) }, null, 1));
console.log(`wrote ${dir}/sample-v2.zip (${zip.length} bytes, ${withDupes.length} cards)`);

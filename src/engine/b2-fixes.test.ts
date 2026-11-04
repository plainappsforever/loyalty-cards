/**
 * @jest-environment node
 */
// B2 fix round (docs/V1_LOG.md P4d, D36–D38): the engine defects the second blind set found and the orchestrator's
// decisions on its ambiguous cases. B2 is a tuning set; these tests restate the SPEC rules, not the set's cases.
import { cleanCategoryName } from '@/db/categories';

import { readBackup } from './backup/reader';
import { writeBackupZip, type BackupCard } from './backup/writer';
import { MIN_BAR_HEIGHT_PX, MIN_BAR_MODULES, layout } from './barcode/layout';
import { toPng } from './barcode/png';
import { renderMatrix } from './barcode/render';
import { validate } from './barcode/validate';
import { emptyCardData } from './card-data';
import { readCatima } from './catima/reader';
import { parseCatimaShareUrl } from './catima/share-url';
import { writeCatimaZip, type ExportCard } from './catima/writer';
import { searchChains } from './chains';
import { CsvFormatError, parseGenericCsv } from './csv';
import { isJpeg, isPng } from './image-bytes';
import { parseSharePayload } from './share-payload';
import { readZip, utf8, writeZip } from './zip';

const lc1 = (o: Record<string, unknown>) => parseSharePayload('LC1:' + JSON.stringify(o));
const BASE = { n: 'Shop', i: '1001', f: 'code128', k: '#1f6f43' };

/** A JPEG-shaped byte string: SOI marker, filler, EOI marker (the reader checks the markers, it does not decode). */
const jpeg = (fill = 7) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, fill, fill, fill, 0xff, 0xd9]);
const realPng = () => toPng(renderMatrix('12345', 'code128'), { modulePx: 1 }).png;

describe('LC1 parser refuses every malformed field (SPEC §5.4 "a malformed field or anything else")', () => {
  it('accepts a well-formed payload with every field', () => {
    expect(lc1({ ...BASE, c: 'X1', t: 'n', b: '12.50', u: 'EUR', e: 1_800_000_000_000, v: 1_700_000_000_000 })).toMatchObject({
      name: 'Shop', number: '1001', codeValue: 'X1', note: 'n', balance: '12.50', balanceCurrency: 'EUR', expiry: 1_800_000_000_000, validFrom: 1_700_000_000_000,
    });
  });
  it.each([
    ['unknown key', { ...BASE, x: 1 }],
    ['string expiry', { ...BASE, e: '1800000000000' }],
    ['fractional expiry', { ...BASE, e: 1_800_000_000_000.5 }],
    ['zero expiry', { ...BASE, e: 0 }],
    ['negative valid-from', { ...BASE, v: -5 }],
    ['null expiry', { ...BASE, e: null }],
    ['non-decimal balance', { ...BASE, b: '12 points' }],
    ['numeric balance', { ...BASE, b: 12.5 }],
    ['empty balance', { ...BASE, b: '' }],
    ['t null', { ...BASE, t: null }],
    ['t number', { ...BASE, t: 5 }],
    ['upper-case colour', { ...BASE, k: '#1F6F43' }],
    ['non-ISO currency', { ...BASE, u: 'PTS' }],
    ['lower-case currency', { ...BASE, u: 'eur' }],
    ['non-string code value', { ...BASE, c: 5 }],
    ['numeric number', { ...BASE, i: 1001 }],
  ])('refuses %s', (_label, payload) => {
    expect(lc1(payload)).toBeNull();
  });
  it('refuses a JSON array', () => {
    expect(parseSharePayload('LC1:["Shop","1001"]')).toBeNull();
  });
});

describe('generic CSV: a declared format is never replaced by another one (SPEC §5.1 every importer)', () => {
  it('a declared EAN-13 that is not one becomes number only with the reason, counted in invalidCodes', () => {
    const r = parseGenericCsv('name,number,format\nShop,4006381333932,EAN13\nKiosk,4006381333931,EAN13\nWeird,999,FOOBAR\n');
    expect(r.cards.map((c) => [c.name, c.format])).toEqual([
      ['Shop', 'none'],
      ['Kiosk', 'ean13'],
      ['Weird', 'code128'], // an UNKNOWN type name → first valid suggestion, raw type kept (SPEC §5.4)
    ]);
    expect(r.cards[0].note).toMatch(/^EAN-13 barcode not drawn: the check digit does not match/);
    expect(r.cards[2].note).toBe('Type: FOOBAR');
    expect(r.invalidCodes).toBe(1);
  });
  it('a declared QR that is too long becomes number only (never Code 128 or another 2D code)', () => {
    const r = parseGenericCsv(`name,number,format\nBig,${'A'.repeat(1001)},QR_CODE\n`);
    expect(r.cards[0].format).toBe('none');
    expect(r.invalidCodes).toBe(1);
  });
  it('a file without a recognised header is refused (no guessing of columns)', () => {
    expect(() => parseGenericCsv('Shop,123,QR_CODE,note\nOther,456\n')).toThrow(CsvFormatError);
    try {
      parseGenericCsv('Shop,123\n');
    } catch (e) {
      expect((e as CsvFormatError).code).toBe('noHeader');
    }
  });
});

describe('Catima link', () => {
  const link = (q: string) => `https://catima.app/share#${encodeURIComponent(q)}`;
  it('without a store (or a blank one) is refused, never an empty-name card', () => {
    expect(parseCatimaShareUrl(link('version=1&cardid=123&barcodetype=CODE_128'))).toBeNull();
    expect(parseCatimaShareUrl(link('version=1&store=%20%20&cardid=123'))).toBeNull();
    expect(parseCatimaShareUrl(link('version=1&store=Shop&cardid=123'))?.name).toBe('Shop');
  });
  it('a store name over 80 characters is cut like the zip reader does (D37)', () => {
    expect(parseCatimaShareUrl(link(`version=1&store=${'S'.repeat(90)}&cardid=123`))?.name).toBe('S'.repeat(80));
  });
});

describe('number-only cap and 1D maximum lengths (D36)', () => {
  it('none holds up to 200 characters (code points), not more', () => {
    expect(validate('9'.repeat(200), 'none').ok).toBe(true);
    expect(validate('9'.repeat(201), 'none')).toMatchObject({ ok: false, error: 'tooLong' });
    expect(validate('🙂'.repeat(200), 'none').ok).toBe(true);
  });
  it('ITF 40, Codabar 40 (start/stop included), Code 39 48, Code 93 48', () => {
    expect([validate('1'.repeat(40), 'itf').ok, validate('1'.repeat(42), 'itf').ok]).toEqual([true, false]);
    expect([validate(`A${'1'.repeat(38)}B`, 'codabar').ok, validate(`A${'1'.repeat(39)}B`, 'codabar').ok]).toEqual([true, false]);
    expect([validate('A'.repeat(48), 'code39').ok, validate('A'.repeat(49), 'code39').ok]).toEqual([true, false]);
    expect([validate('A'.repeat(48), 'code93').ok, validate('A'.repeat(49), 'code93').ok]).toEqual([true, false]);
  });
});

describe('chain search', () => {
  it('a punctuation-only query matches nothing; an empty query still lists the country', () => {
    expect(searchChains('&', 'DE')).toEqual([]);
    expect(searchChains(' - ', 'DE')).toEqual([]);
    expect(searchChains('', 'DE').length).toBeGreaterThan(0);
    expect(searchChains('h&m')[0].id).toBe('de-hm');
  });
});

describe('layout: the 1D bar height is never below 25 % of the symbol width (rounded up, LY-04)', () => {
  it('holds for every width that has room', () => {
    for (let modules = 20; modules <= 400; modules += 7) {
      for (const w of [320, 467, 1170, 1868, 2048]) {
        const l = layout({ kind: '1d', modulesWide: modules, modulesHigh: 1 }, { widthPx: w, heightPx: 4000 }, 3);
        const room = l.rotate ? w : 4000; // the bar height is capped by the space across the bars
        const ok = l.heightPx === room || (l.heightPx * 4 >= l.widthPx && l.heightPx >= MIN_BAR_HEIGHT_PX && l.heightPx >= MIN_BAR_MODULES * l.modulePx);
        expect({ modules, w, ok }).toEqual({ modules, w, ok: true });
      }
    }
  });
});

describe('Catima export writes only PNG bytes under .png names (CE-05)', () => {
  const card: ExportCard = { ...emptyCardData(), name: 'Shop', number: '123', format: 'code128' };
  it('a PNG photo is written; a JPEG photo is left out and reported (the export flow converts photos first)', () => {
    const png = realPng();
    const out = writeCatimaZip([{ ...card, images: { front: png, back: jpeg() } }]);
    const entries = readZip(out.zip);
    expect(Object.keys(entries).sort()).toEqual(['card_1_front.png', 'catima.csv']);
    expect(isPng(entries['card_1_front.png'])).toBe(true);
    expect(out.dropped).toEqual([{ index: 0, name: 'Shop', field: 'image', value: 'back' }]);
    expect(readCatima(out.zip).cards[0].images.front).toEqual(png);
  });
  it('isPng / isJpeg check the markers at both ends', () => {
    expect(isPng(realPng())).toBe(true);
    expect(isPng(new Uint8Array([137, 80, 78, 71, 1]))).toBe(false);
    expect(isJpeg(jpeg())).toBe(true);
    expect(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]))).toBe(false); // truncated: no end marker
    expect(isJpeg(new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe('own backup reader decisions (D37)', () => {
  const card: BackupCard = { ...emptyCardData(), id: 'c1', name: 'Shop', number: '123', format: 'code128', color: '#1f6f43', tile: 'initials', chainId: null, useCount: 0, sortIndex: 0, createdAt: 1, updatedAt: 1 };
  const json = () => JSON.parse(utf8.decode(readZip(writeBackupZip([card], [], 5))['backup.json']));
  it('another app (or no app) is refused', () => {
    expect(() => readBackup(utf8.encode(JSON.stringify({ ...json(), app: 'other-app' })))).toThrow('notBackup');
    const { app: _app, ...noApp } = json();
    expect(() => readBackup(utf8.encode(JSON.stringify(noApp)))).toThrow('notBackup');
  });
  it('links are optional; a bare backup.json is accepted; a lower-case currency is normalised', () => {
    const { links: _links, ...noLinks } = json();
    expect(readBackup(utf8.encode(JSON.stringify(noLinks))).cards).toHaveLength(1);
    const j = json();
    j.cards[0].balance = '5';
    j.cards[0].balanceCurrency = 'eur';
    expect(readBackup(utf8.encode(JSON.stringify(j))).cards[0].balanceCurrency).toBe('EUR');
  });
  it('a broken photo: the card is imported without it and the photo is reported', () => {
    const zip = writeZip({ 'backup.json': utf8.encode(JSON.stringify({ ...json(), cards: [card, { ...card, id: 'c2', name: 'Two' }] })), 'cards/c1/front.jpg': new Uint8Array([1, 2, 3]), 'cards/c1/back.jpg': jpeg(), 'cards/c2/front.jpg': jpeg(9) });
    const r = readBackup(zip);
    expect(r.cards.map((c) => [c.name, !!c.images.front, !!c.images.back])).toEqual([
      ['Shop', false, true],
      ['Two', true, false],
    ]);
    expect(r.brokenPhotos).toEqual([{ row: 1, name: 'Shop', side: 'front' }]);
  });
});

describe('categories', () => {
  it('names are trimmed; the trimmed form is the stored name', () => {
    expect(cleanCategoryName('Food ')).toBe('Food');
    expect(cleanCategoryName('  Fuel  & more ')).toBe('Fuel & more');
  });
});

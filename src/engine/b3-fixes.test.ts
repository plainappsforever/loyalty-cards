/**
 * @jest-environment node
 */
// B3 fix round (docs/V1_LOG.md "Blind set B3", D45–D47): the engine defects the third blind set found, the orchestrator's
// decisions on its SPEC gaps, and the ambiguous readings the engine takes, pinned. B3 is a tuning set; these tests
// restate the SPEC rules with our own values, not the set's cases.
import { readBackup } from './backup/reader';
import { writeBackupZip, type BackupCard } from './backup/writer';
import { AZTEC_EC_MAX_BYTES, AZTEC_EC_PERCENT, clearEncodeCache, encodeRaw, encoderOptions, fitsSymbol, type Raw2D } from './barcode/encode';
import { FORMATS } from './barcode/formats';
import { layout } from './barcode/layout';
import { renderMatrix, symbolSize } from './barcode/render';
import { validate } from './barcode/validate';
import { emptyCardData } from './card-data';
import { readCatima } from './catima/reader';
import { CATIMA_CARD_COLUMNS, writeCatimaCsv, type ExportCard } from './catima/writer';
import { CsvFormatError, parseGenericCsv } from './csv';
import { parseCsv } from './csv-core';
import { searchCards } from './search';
import { parseSharePayload } from './share-payload';
import { NAME_COLLATION, sortCards, type Sortable } from './sort';
import { buildSnapshot } from './widgets';
import { readZip, utf8, writeZip } from './zip';

const bytes = (s: string) => utf8.encode(s).length;

describe('generic CSV: a file without a header row is refused (D45.1, SPEC §5.4)', () => {
  it.each([
    ['empty', ''],
    ['BOM only', '﻿'],
    ['blank lines only', '\r\n\r\n'],
    ['BOM and a blank line', '﻿\n'],
  ])('%s → noHeader, never "0 cards"', (_label, text) => {
    expect(() => parseGenericCsv(text)).toThrow(CsvFormatError);
    expect(() => parseGenericCsv(text)).toThrow('noHeader');
  });
  it('a header without rows is still a valid, empty list', () => {
    expect(parseGenericCsv('name,number\r\n').cards).toEqual([]);
  });
});

describe('generic CSV: category/color/balance are read, unknown extra columns ignored (D45.5, B3 GC-29)', () => {
  it('reads the known optional columns when present', () => {
    const r = parseGenericCsv('name,number,category,color,balance\nCafe,CF-1,Food,#FF0000,12\n');
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0]).toMatchObject({ name: 'Cafe', number: 'CF-1', categories: ['Food'], color: '#ff0000', balance: '12' });
  });
  it('ignores columns it does not know and never refuses the file for them', () => {
    const r = parseGenericCsv('loyalty tier,name,shoe size,number,remarks2\nGold,Cafe,44,CF-1,x\n');
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0]).toMatchObject({ name: 'Cafe', number: 'CF-1', note: '', categories: [], balance: '' });
    expect(Object.keys(r.columns).sort()).toEqual(['name', 'number']);
  });
});

describe('name sort is accent-sensitive (D45.2, SPEC §5.6 "accents secondary")', () => {
  const card = (id: string, name: string, sortIndex: number): Sortable => ({ id, name, favourite: false, sortIndex, useCount: 0, lastUsedAt: null, createdAt: 0 });
  it('the unaccented name sorts before the accented one whatever the manual order', () => {
    const cards = [card('z1', 'Zürich', 0), card('z2', 'Zug', 1), card('z3', 'Zurich', 2)];
    expect(sortCards(cards, 'name', 'de').map((c) => c.id)).toEqual(['z2', 'z3', 'z1']);
    expect(sortCards(cards, 'name', 'en').map((c) => c.id)).toEqual(['z2', 'z3', 'z1']);
    expect(sortCards([card('e1', 'Café', 0), card('e2', 'Cafe', 1)], 'name', 'fr').map((c) => c.id)).toEqual(['e2', 'e1']);
  });
  it('case alone still ties and falls to the manual order; numbers sort numerically', () => {
    expect(NAME_COLLATION).toEqual({ sensitivity: 'accent', numeric: true });
    expect(sortCards([card('b', 'apple', 1), card('a', 'Apple', 0)], 'name').map((c) => c.id)).toEqual(['a', 'b']);
    expect(sortCards([card('b', 'apple', 0), card('a', 'Apple', 1)], 'name').map((c) => c.id)).toEqual(['b', 'a']);
    expect(sortCards([card('x', 'Card 10', 0), card('y', 'Card 9', 1)], 'name').map((c) => c.id)).toEqual(['y', 'x']);
  });
});

describe('Catima writer: a never-used card has an EMPTY lastused cell (D45.3)', () => {
  const base: ExportCard = { ...emptyCardData(), name: 'Shop', number: '1001', format: 'code128', color: '#1f6f43' };
  const cell = (cards: ExportCard[], row: number) => {
    const rows = parseCsv(writeCatimaCsv(cards));
    const header = rows.findIndex((r) => r[0] === '_id' && r.length > 1);
    return rows[header + 1 + row][CATIMA_CARD_COLUMNS.indexOf('lastused')];
  };
  it('null → empty; a real use → Unix seconds', () => {
    expect(cell([base], 0)).toBe('');
    expect(cell([{ ...base, lastUsedAt: 1_750_000_000_999 }], 0)).toBe('1750000000');
  });
  it('round trip: empty reads back as never used', () => {
    const back = readCatima(utf8.encode(writeCatimaCsv([base, { ...base, name: 'Used', lastUsedAt: 1_750_000_000_000 }])));
    expect(back.cards.map((c) => c.lastUsedAt)).toEqual([null, 1_750_000_000_000]);
  });
});

describe('layout: a 1D code that does not fit the portrait width is ALWAYS rotated (D45.4, SPEC §5.2 literal)', () => {
  const m = { kind: '1d' as const, modulesWide: 115, modulesHigh: 32 };
  it('rotates even when the rotated room is smaller (landscape-shaped box), and says it is dense', () => {
    const l = layout(m, { widthPx: 300, heightPx: 150 }, 3);
    expect(l.rotate).toBe(true);
    expect(l.modulePx).toBe(1); // recomputed for the height: floor(150 / 115)
    expect(l.dense).toBe(true);
  });
  it('rotates on a tall screen with the larger scale; no rotation when portrait fits', () => {
    expect(layout(m, { widthPx: 300, heightPx: 800 }, 3)).toMatchObject({ rotate: true, modulePx: 6, dense: false });
    expect(layout(m, { widthPx: 345, heightPx: 150 }, 3)).toMatchObject({ rotate: false, modulePx: 3, dense: false });
  });
  it('2D codes are never rotated (square: turning them changes nothing)', () => {
    expect(layout({ kind: '2d', modulesWide: 120, modulesHigh: 120 }, { widthPx: 300, heightPx: 150 }, 4).rotate).toBe(false);
  });
});

describe('Aztec: 33 % error correction and a 4-module quiet zone, capacity unchanged (D46, B3 A2 dim miss)', () => {
  it('options and quiet zone', () => {
    expect(AZTEC_EC_PERCENT).toBe(33);
    expect(encoderOptions('AZ-1', 'aztec')).toEqual({ eclevel: 33 });
    expect(encoderOptions('ö', 'aztec')).toEqual({ parsefnc: true, eclevel: 33 });
    expect(FORMATS.aztec.quietLeft).toBe(4);
    const m = renderMatrix('AZTEC-CARD-778899', 'aztec');
    expect(m.quiet).toEqual({ left: 4, right: 4, top: 4, bottom: 4 });
    expect(m.modulesWide - symbolSize(m).wide).toBe(8);
  });
  it('the heaviest realistic class (1,480 UTF-8 bytes) gets the larger, 33 % symbol', () => {
    clearEncodeCache();
    const raw = encodeRaw('ö'.repeat(740), 'aztec') as Raw2D;
    expect(raw.pixx).toBe(147); // 23 %: 135 modules
  });
  it('a value that fits only at the bwipp default (23 %) is still drawn: no card loses its code', () => {
    const v = 'ö'.repeat(900); // 1,800 bytes: over AZTEC_EC_MAX_BYTES, under the 32-layer limit
    expect(bytes(v)).toBeGreaterThan(AZTEC_EC_MAX_BYTES);
    expect(fitsSymbol(v, 'aztec')).toBe(true);
    expect(validate(v, 'aztec').ok).toBe(true);
    expect(encoderOptions(v, 'aztec')).toEqual({ parsefnc: true }); // bwipp's default level, as before D46
    expect((encodeRaw(v, 'aztec') as Raw2D).pixx).toBeLessThanOrEqual(151); // 32 layers at most
    expect(fitsSymbol('ö'.repeat(960), 'aztec')).toBe(false); // over the symbol, as before (D32)
  });
});

describe('ambiguous readings the engine takes, settled (D47)', () => {
  const card: BackupCard = { ...emptyCardData(), id: 'c1', name: 'Shop', number: '123', format: 'code128', color: '#1f6f43', tile: 'initials', chainId: null, useCount: 0, sortIndex: 0, createdAt: 1, updatedAt: 1 };
  const json = () => JSON.parse(utf8.decode(readZip(writeBackupZip([card], [], 5))['backup.json']));
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7, 0xff, 0xd9]);

  it('B32: a complete JPEG followed by zero padding is attached (not a broken photo)', () => {
    const zip = writeBackupZip([{ ...card, images: { front: new Uint8Array([...jpeg, 0, 0, 0, 0]) } }], [], 5);
    const r = readBackup(zip);
    expect(r.cards[0].images.front).toBeDefined();
    expect(r.brokenPhotos).toEqual([]);
  });
  it('B36: a non-integer exportedAt is ignored (null), the file is read', () => {
    for (const exportedAt of ['yesterday', 1.5, -0.5]) {
      const r = readBackup(utf8.encode(JSON.stringify({ ...json(), exportedAt })));
      expect([r.exportedAt, r.cards.length]).toEqual([null, 1]);
    }
  });
  it('B37: a mixed-case currency code is upper-cased (Eur → EUR), like lower case (D37.3)', () => {
    const j = json();
    j.cards[0].balance = '2';
    j.cards[0].balanceCurrency = 'Eur';
    const r = readBackup(utf8.encode(JSON.stringify(j)));
    expect([r.cards[0].balanceCurrency, r.cards[0].note]).toEqual(['EUR', '']);
  });
  it('B14: the Catima reader attaches a broken PNG as is (the import flow converts it natively and counts a failure)', () => {
    const csv = utf8.encode('2\r\n\r\n_id\r\n\r\n_id,store,cardid,barcodetype\r\n1,Shop,123,CODE_128\r\n\r\ncardId,groupId\r\n');
    const broken = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const r = readCatima(writeZip({ 'catima.csv': csv, 'card_1_front.png': broken }));
    expect(r.cards[0].images.front).toEqual(broken);
  });
  it('B25: an LC1 payload with an empty balance or currency is refused (the writer never writes them empty)', () => {
    const base = { n: 'Shop', i: '1001', f: 'code128', k: '#1f6f43' };
    expect(parseSharePayload('LC1:' + JSON.stringify(base))).not.toBeNull();
    expect(parseSharePayload('LC1:' + JSON.stringify({ ...base, b: '' }))).toBeNull();
    expect(parseSharePayload('LC1:' + JSON.stringify({ ...base, u: '' }))).toBeNull();
  });
  it('B01: no-break, narrow no-break and thin spaces inside an EAN-13 are separators like a space or hyphen; other dashes are not', () => {
    for (const sep of [' ', ' ', ' ', ' ', '-']) {
      const v = validate(`4006381${sep}333931`, 'ean13');
      expect(v.ok && v.value).toBe('4006381333931');
    }
    for (const sep of ['–', '‑', '.']) expect(validate(`4006381${sep}333931`, 'ean13').ok).toBe(false);
  });
  const s = (id: string, name: string, number = '0') => ({ id, name, number, note: '' });
  it('B49: a query for the unvoiced kana finds the voiced one (NFD keeps the voiced mark as its own character)', () => {
    const cards = [s('a9', 'ガスト'), s('b', 'カメ')];
    expect(searchCards(cards, 'カ').map((c) => c.id).sort()).toEqual(['a9', 'b']);
    expect(searchCards(cards, 'ガ').map((c) => c.id)).toEqual(['a9']);
  });
  it('B51: a number typed in groups (as the card screen shows it) matches', () => {
    const cards = [s('a1', 'Shop', '1234567890123'), s('b', 'Other', '5555')];
    expect(searchCards(cards, '1234 5678 9012').map((c) => c.id)).toEqual(['a1']);
  });
  it('B52: more favourites than widget slots → the first 8 in the order given (the user’s list order)', () => {
    const fav = Array.from({ length: 10 }, (_, i) => ({ id: `v${i}`, name: `V${i}`, favourite: true, sortIndex: i, useCount: i, lastUsedAt: null, createdAt: 0, archived: false, color: '#000000', format: 'code128' }));
    expect(buildSnapshot(fav, [], 1).cards.map((c) => c.id)).toEqual(['v0', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7']);
  });
});

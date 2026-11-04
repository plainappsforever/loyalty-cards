/**
 * @jest-environment node
 */
import type { FormatId } from '../barcode/formats';
import { renderPng } from '../barcode/png';
import { validate } from '../barcode/validate';
import type { CardData } from '../card-data';
import { parseCsv } from '../csv-core';
import { readZip, utf8 } from '../zip';

import { catimaColorToHex, colorForName, hexToCatimaColor } from './color';
import { CatimaFormatError, parseCatimaCsv, readCatima } from './reader';
import { buildCatimaShareUrl, parseCatimaShareUrl } from './share-url';
import { CATIMA_CARD_COLUMNS, writeCatimaCsv, writeCatimaZip, type ExportCard } from './writer';

const NAMES = ['Nordmarkt', 'Kaffeehaus Lila', 'Çağdaş Market', 'Ηλεκτρονικά', 'Магазин Ромашка', 'मेरी दुकान', 'お店', '商店', '가게', 'Cửa hàng', 'متجر', 'Loja do João', 'Tienda Ñandú', 'Épicerie', 'Sklep Żółw', 'Bücherecke'];
const FORMATS: FormatId[] = ['none', 'code128', 'ean13', 'ean8', 'upca', 'upce', 'itf', 'codabar', 'code39', 'code93', 'qr', 'aztec', 'pdf417', 'datamatrix'];

/** ≥ 40 cards: every format, 15-language names, multi-line notes, colours incl. dark ones, timestamps, groups. */
function fixtureCards(): ExportCard[] {
  const out: ExportCard[] = [];
  for (let i = 0; i < 44; i++) {
    const f = FORMATS[i % FORMATS.length];
    out.push({
      name: `${NAMES[i % NAMES.length]} ${i}`,
      number: f === 'ean13' ? '4006381333931' : f === 'ean8' ? '96385074' : f === 'upca' ? '036000291452' : f === 'upce' ? '01234565' : `${1000 + i}`,
      // a separate barcode value only where the format can hold it (review M1: the old fixture paired UPC-E with 'CODE-5')
      codeValue: i % 5 === 0 && (f === 'none' || validate(`CODE-${i}`, f).ok) ? `CODE-${i}` : '',
      format: f,
      color: ['#1f6f43', '#000000', '#ffffff', '#e0a100', '#6b2fa0'][i % 5],
      note: i % 3 === 0 ? `line one, with comma\nline "two" quoted\r\nline three` : i % 3 === 1 ? '' : 'plain note',
      balance: i % 4 === 0 ? '12.50' : i % 4 === 1 ? '0' : '',
      balanceCurrency: i % 4 === 0 ? 'EUR' : '',
      validFrom: i % 6 === 0 ? 1_700_000_000_000 : null,
      expiry: i % 2 === 0 ? 1_800_000_000_000 + i * 1000 : null,
      favourite: i % 7 === 0,
      archived: i % 11 === 0,
      lastUsedAt: i % 2 === 0 ? 1_750_000_000_000 : null,
      categories: i % 3 === 0 ? ['Food', 'Travel & "Fun"'] : i % 3 === 1 ? ['Food'] : [],
      // real PNG bytes: the writer leaves out anything that is not PNG (B2 CE-05)
      images: i % 8 === 0 ? { front: renderPng(String(1000 + i), 'code128', 1).png, icon: renderPng(String(2000 + i), 'code128', 1).png } : undefined,
    });
  }
  return out;
}

const comparable = (c: CardData & { images?: unknown }) => {
  const { images: _images, ...rest } = c;
  return { ...rest, note: rest.note.replace(/\r\n?/g, '\n'), balance: rest.balance === '' ? '0' : rest.balance, lastUsedAt: rest.lastUsedAt === null ? null : Math.floor(rest.lastUsedAt / 1000) * 1000 };
};

describe('Catima round trip (A4)', () => {
  it('writer → reader is lossless for every field Catima knows, images included', () => {
    const cards = fixtureCards();
    for (const c of cards) expect({ name: c.name, ok: validate(c.codeValue || c.number, c.format).ok }).toEqual({ name: c.name, ok: true });
    const out = writeCatimaZip(cards);
    expect(out).toMatchObject({ exported: cards.length, omitted: [], dropped: [] });
    const zip = out.zip;
    const back = readCatima(zip);
    expect(back.version).toBe(2);
    expect(back.skipped).toEqual([]);
    expect(back.invalidCodes).toBe(0);
    expect(back.cards).toHaveLength(cards.length);
    expect(back.groups).toEqual(['Food', 'Travel & "Fun"']);
    cards.forEach((c, i) => {
      const r = back.cards[i];
      const { images, ...rest } = r;
      expect(comparable(rest)).toEqual(comparable(c));
      expect(images.front).toEqual(c.images?.front);
      expect(images.icon).toEqual(c.images?.icon);
      expect(images.back).toBeUndefined();
    });
    // the CSV itself: version line, RFC 4180 quoting with CRLF, numeric ids, images named by id
    const entries = readZip(zip);
    const csv = utf8.decode(entries['catima.csv']);
    expect(csv.startsWith('2\r\n\r\n_id\r\n')).toBe(true);
    expect(csv).toContain(CATIMA_CARD_COLUMNS.join(','));
    expect(Object.keys(entries).filter((n) => n.endsWith('.png')).sort()).toEqual(['card_1_front.png', 'card_1_icon.png', 'card_17_front.png', 'card_17_icon.png', 'card_25_front.png', 'card_25_icon.png', 'card_33_front.png', 'card_33_icon.png', 'card_41_front.png', 'card_41_icon.png', 'card_9_front.png', 'card_9_icon.png'].sort());
    const rows = parseCsv(csv);
    const header = rows.findIndex((r) => r[0] === '_id' && r.length > 1);
    expect(rows[header + 1][CATIMA_CARD_COLUMNS.indexOf('lastused')]).toBe('1750000000'); // seconds
    expect(rows[header + 1][CATIMA_CARD_COLUMNS.indexOf('expiry')]).toBe('1800000000000'); // ms
    expect(rows[header + 1][CATIMA_CARD_COLUMNS.indexOf('headercolor')]).toBe(String(hexToCatimaColor('#1f6f43')));
  });

  it('writes a bare CSV that parses as version 2 too', () => {
    const cards = fixtureCards().slice(0, 3);
    const back = readCatima(utf8.encode(writeCatimaCsv(cards)));
    expect(back.cards.map((c) => c.name)).toEqual(cards.map((c) => c.name));
  });
});

describe('Catima reader edge cases (SPEC §5.3, §9)', () => {
  it('reads a version-1 bare CSV with missing columns, BOM and CRLF', () => {
    const v1 = '﻿_id,store,note,cardid,barcodetype,headercolor\r\n1,Old Shop,"multi\r\nline",12345,CODE_128,-9977996\r\n2,No Type,,777,,\r\n';
    const r = parseCatimaCsv(v1);
    expect(r.version).toBe(1);
    expect(r.cards).toHaveLength(2);
    expect(r.cards[0]).toMatchObject({ name: 'Old Shop', number: '12345', format: 'code128', note: 'multi\nline', color: '#67bf74', balance: '', expiry: null, lastUsedAt: null, categories: [] });
    expect(r.cards[1]).toMatchObject({ name: 'No Type', format: 'none', color: colorForName('No Type') });
  });

  it('maps the 16 Catima types: 13 rendered, MAXICODE/RSS → none with the type kept in the note', () => {
    const types = ['AZTEC', 'CODABAR', 'CODE_39', 'CODE_93', 'CODE_128', 'DATA_MATRIX', 'EAN_8', 'EAN_13', 'ITF', 'MAXICODE', 'PDF_417', 'QR_CODE', 'RSS_14', 'RSS_EXPANDED', 'UPC_A', 'UPC_E'];
    // a number each type is valid for (review M1: an invalid pair now imports as number only)
    const valid: Record<string, string> = { CODABAR: 'A1234B', EAN_8: '96385074', EAN_13: '4006381333931', ITF: '1234', UPC_A: '036000291452', UPC_E: '01234565' };
    const csv = ['2', '', '_id', '', 'store,note,cardid,barcodetype', ...types.map((t, i) => `S${i},${i === 0 ? 'has note' : ''},${valid[t] ?? i},${t}`), '', 'cardId,groupId'].join('\n');
    const r = parseCatimaCsv(csv);
    expect(r.cards.map((c) => c.format)).toEqual(['aztec', 'codabar', 'code39', 'code93', 'code128', 'datamatrix', 'ean8', 'ean13', 'itf', 'none', 'pdf417', 'qr', 'none', 'none', 'upca', 'upce']);
    expect(r.cards[9].note).toBe('Catima type: MAXICODE');
    expect(r.cards[12].note).toBe('Catima type: RSS_14');
    expect(r.cards[0].note).toBe('has note');
  });

  it('skips rows with empty name or number with the row number and reason; groups come from links too', () => {
    const csv = ['2', '', '_id', 'Food', '', '_id,store,cardid', '1,,123', '2,Shop,', '3,,', '4,Good,42', '', 'cardId,groupId', '4,Food', '4,Travel', '9,Food'].join('\r\n');
    const r = parseCatimaCsv(csv);
    expect(r.cards.map((c) => c.name)).toEqual(['Good']);
    expect(r.cards[0].categories).toEqual(['Food', 'Travel']);
    expect(r.groups).toEqual(['Food', 'Travel']);
    expect(r.skipped).toEqual([
      { row: 7, reason: 'emptyName' },
      { row: 8, reason: 'emptyNumber' },
      { row: 9, reason: 'badRow' },
    ]);
  });

  it('rejects an encrypted zip, a zip without catima.csv, and text that is not Catima', () => {
    const aes = new Uint8Array(40);
    aes.set([0x50, 0x4b, 0x03, 0x04, 20, 0, 1, 0, 99, 0]);
    expect(() => readCatima(aes)).toThrow(CatimaFormatError);
    expect((() => {
      try {
        readCatima(aes);
      } catch (e) {
        return (e as CatimaFormatError).code;
      }
    })()).toBe('encrypted');
    expect(() => readCatima(utf8.encode('name,number\nA,1\n'))).toThrow('notCatima');
  });

  it('colour ints round-trip, including negative values and alpha', () => {
    expect(catimaColorToHex('-9977996')).toBe('#67bf74');
    expect(catimaColorToHex(-16777216)).toBe('#000000');
    expect(catimaColorToHex('')).toBeNull();
    expect(catimaColorToHex('abc')).toBeNull();
    for (const hex of ['#000000', '#ffffff', '#67bf74', '#1f6f43']) expect(catimaColorToHex(hexToCatimaColor(hex))).toBe(hex);
    expect(hexToCatimaColor('#67bf74')).toBe(-9977996);
  });
});

describe('Catima share URL (D18)', () => {
  it('parses the documented 2.0 example (fragment, double-encoded) and the legacy query form', () => {
    const modern = parseCatimaShareUrl('https://catima.app/share#store%3DGrocery%2BStore%26note%3DQuite%2Bnecessary%26balance%3D150%26cardid%3Ddhd%26barcodetype%3DAZTEC%26headercolor%3D-9977996');
    expect(modern).toMatchObject({ name: 'Grocery Store', note: 'Quite necessary', balance: '150', number: 'dhd', format: 'aztec', color: '#67bf74' });
    const legacy = parseCatimaShareUrl('https://catima.app/share?store=Grocery%20Store&note=Quite%20necessary&balance=150&cardid=dhd&barcodetype=AZTEC&headercolor=-9977996');
    expect(legacy).toEqual(modern);
    expect(parseCatimaShareUrl('https://thelastproject.github.io/Catima/share?cardid=1&store=X')?.name).toBe('X');
    expect(parseCatimaShareUrl('https://example.com/share#cardid%3D1')).toBeNull();
    expect(parseCatimaShareUrl('https://catima.app/share#store%3DX')).toBeNull(); // no card id
    expect(parseCatimaShareUrl('not a url')).toBeNull();
  });
  it('generates the 2.0 form and round-trips every field, unknown types kept', () => {
    const card = { name: 'Käse & Wein', number: '4006381333931', codeValue: '', format: 'ean13' as const, color: '#1f6f43', note: 'multi\nline ü=&#', balance: '12.50', balanceCurrency: 'EUR', validFrom: 1_700_000_000_000, expiry: 1_800_000_000_000 };
    const url = buildCatimaShareUrl(card)!;
    expect(url.startsWith('https://catima.app/share#')).toBe(true);
    expect(url).not.toContain('&'); // double-encoded: no raw separators in the fragment
    expect(parseCatimaShareUrl(url)).toEqual({ ...card, unknownType: null });
    expect(parseCatimaShareUrl('https://catima.app/share?cardid=1&store=X&barcodetype=MAXICODE')).toMatchObject({ format: 'none', unknownType: 'MAXICODE' });
  });
});

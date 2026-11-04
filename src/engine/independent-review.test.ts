/**
 * @jest-environment node
 */
// Reproductions of docs/REVIEW_ENGINE_INDEPENDENT.md (P4c, L25: a finding is real once a test shows it). Each `describe`
// names the finding; the test was written BEFORE the fix and failed on bcc75af/335bea2 (V1_LOG "P4c fix round").
import { zipSync } from 'fflate';

import { readBackup } from './backup/reader';
import { writeBackupZip, type BackupCard } from './backup/writer';
import { layout, MIN_BAR_MODULES } from './barcode/layout';
import { renderPng } from './barcode/png';
import { renderMatrix } from './barcode/render';
import { renderSvg } from './barcode/svg';
import { suggestFormats, validate } from './barcode/validate';
import { emptyCardData, type CardData } from './card-data';
import { readCatima } from './catima/reader';
import { buildCatimaShareUrl, parseCatimaShareUrl } from './catima/share-url';
import { writeCatimaZip, type ExportCard } from './catima/writer';
import { searchChains } from './chains';
import { parseGenericCsv, writeGenericCsv } from './csv';
import { parseCsv } from './csv-core';
import { ISO_4217 } from './currency';
import { buildSharePayload, parseSharePayload } from './share-payload';
import { readZip, utf8 } from './zip';
import { catimaImportProblems } from '../../test/catima-import-model';
import { prepare, score, type Decoded } from '../../test/render-set';
import { encodeRaw, TRIAL_FREE_BYTES } from './barcode/encode';

const card = (o: Partial<CardData> = {}): CardData => ({ ...emptyCardData(), name: 'Shop', color: '#1f6f43', ...o });
/** The pairs the review rendered and Vision read as a DIFFERENT value (M1). */
const SILENTLY_CHANGED: [string, Parameters<typeof renderMatrix>[1]][] = [
  ['400638133393', 'ean13'],
  ['03600029145', 'upca'],
  ['9638507', 'ean8'],
  ['0123456', 'upce'],
  ['12345', 'itf'],
  ['hello\u0001', 'code128'],
  ['x'.repeat(120), 'code128'],
];

describe('M1 — rendering refuses what validate() rejects; importers check number vs format', () => {
  it('renderMatrix / renderSvg / renderPng refuse every value validate() rejects', () => {
    for (const [v, f] of SILENTLY_CHANGED) {
      expect(validate(v, f).ok).toBe(false);
      expect(() => renderMatrix(v, f)).toThrow(/cannot draw/);
      expect(() => renderSvg(v, f, { modulePx: 3 })).toThrow(/cannot draw/);
      expect(() => renderPng(v, f, 3)).toThrow(/cannot draw/);
    }
  });
  it('lower-case Code 39 from a file renders as its canonical upper-case value instead of throwing', () => {
    expect(renderMatrix('abc', 'code39').rows).toEqual(renderMatrix('ABC', 'code39').rows);
  });
  it('Catima row EAN_13 with 12 digits → number only, number kept, reason + suggestion in the note, counted', () => {
    const csv = ['2', '', '_id', '', '_id,store,note,cardid,barcodeid,barcodetype', '1,Shop,,400638133393,,EAN_13', '2,Lib,,abc,,CODE_39', '', 'cardId,groupId'].join('\r\n');
    const r = readCatima(utf8.encode(csv));
    expect(r.cards[0]).toMatchObject({ number: '400638133393', format: 'none' });
    expect(r.cards[0].note).toContain('EAN-13');
    expect(r.cards[0].note).toContain('4006381333931');
    expect(r.invalidCodes).toBe(1);
    expect(r.cards[1]).toMatchObject({ number: 'abc', format: 'code39' });
    expect(r.cards[1].note).toContain('ABC'); // Code 39 has no lower case: said, not hidden
  });
  it('own backup, LC1 payload and Catima link apply the same check', () => {
    const b: BackupCard = { ...card({ number: '400638133393', format: 'ean13' }), id: 'b1', tile: 'initials', chainId: null, useCount: 0, sortIndex: 0, createdAt: 1, updatedAt: 1 };
    const back = readBackup(writeBackupZip([b], [], 1));
    expect(back.cards[0]).toMatchObject({ number: '400638133393', format: 'none' });
    expect(back.invalidCodes).toBe(1);
    const lc1 = parseSharePayload('LC1:' + JSON.stringify({ n: 'Shop', i: '400638133393', f: 'ean13', k: '#1f6f43' }));
    expect(lc1).toMatchObject({ number: '400638133393', format: 'none' });
    expect(lc1!.note).toContain('EAN-13');
    const link = parseCatimaShareUrl('https://catima.app/share?store=Shop&cardid=400638133393&barcodetype=EAN_13');
    expect(link).toMatchObject({ number: '400638133393', format: 'none' });
    expect(link!.note).toContain('EAN-13');
  });
});

describe('M2 — generic CSV picks only a format the number passes', () => {
  it('7, 11 and 12 digits in a two-column sheet get a format they are valid for', () => {
    const r = parseGenericCsv('name,number\nLibrary,1234567\nGym,12345678901\nShop,400638133393\n');
    expect(r.cards).toHaveLength(3);
    for (const c of r.cards) expect({ n: c.number, ok: validate(c.number, c.format).ok }).toEqual({ n: c.number, ok: true });
  });
});

describe('M3 — 2D limits by real symbol capacity, not character count', () => {
  const heavy: [string, Parameters<typeof renderMatrix>[1]][] = [
    ['ü'.repeat(1000), 'aztec'],
    ['ü'.repeat(1000), 'pdf417'],
    ['ü'.repeat(1000), 'datamatrix'],
    ['🙂'.repeat(300), 'pdf417'],
    ['日'.repeat(500), 'pdf417'],
    ['日'.repeat(1000), 'qr'],
    ['🙂'.repeat(1000), 'qr'],
    ['aB3$%&()~^|{}\u0001\u007f'.repeat(72).slice(0, 1000), 'pdf417'], // pure ASCII, 1,000 chars: does not fit PDF417 either
  ];
  it('values no symbol can hold are refused (capacity); everything validate accepts can be drawn', () => {
    for (const [v, f] of heavy) {
      expect({ f, len: v.length, r: validate(v, f) }).toEqual({ f, len: v.length, r: { ok: false, error: 'capacity' } }); // Q8: own reason
    }
  });
  it('the limit is exact at the measured capacity (UTF-8 bytes incl. ECI 26), not stricter', () => {
    const fitsAt: [string, number, Parameters<typeof renderMatrix>[1]][] = [
      ['ü', 553, 'pdf417'],
      ['ü', 777, 'datamatrix'],
      ['ü', 955, 'aztec'],
      ['日', 777, 'qr'],
    ];
    for (const [u, n, f] of fitsAt) {
      expect({ f, n, ok: validate(u.repeat(n), f).ok }).toEqual({ f, n, ok: true });
      expect(() => renderMatrix(u.repeat(n), f)).not.toThrow();
      expect({ f, n: n + 1, r: validate(u.repeat(n + 1), f) }).toEqual({ f, n: n + 1, r: { ok: false, error: 'capacity' } });
    }
  });
});

describe('M3 — the byte fast path is safe: every value under TRIAL_FREE_BYTES encodes, whatever the mix', () => {
  it('fuzzed mixtures of digits, letters, punctuation, control, Latin-1, CJK and emoji at the fast-path size all encode', () => {
    const pools = ['0123456789', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~ ', '\u0001\u001f\u007f', 'äöüßéñ', '日本語中文한국', '🙂🎉👍'].map((p) => [...p]);
    let seed = 20261016;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const bytes = (s: string) => new TextEncoder().encode(s).length;
    for (const f of ['qr', 'aztec', 'pdf417', 'datamatrix'] as const) {
      const limit = TRIAL_FREE_BYTES[f]!;
      for (let t = 0; t < 12; t++) {
        let v = '';
        let k = 0;
        while (true) {
          const pool = t % 3 === 0 ? pools[k++ % pools.length] : pools[Math.floor(rnd() * pools.length)];
          const run = t % 3 === 0 ? 1 : 1 + Math.floor(rnd() * (t % 3 === 1 ? 3 : 15));
          let next = v;
          for (let i = 0; i < run; i++) next += pool[Math.floor(rnd() * pool.length)];
          if (bytes(next) > limit) break;
          v = next;
        }
        v = v.trim();
        expect({ f, t, ok: validate(v, f).ok }).toEqual({ f, t, ok: true });
        expect(() => encodeRaw(v, f)).not.toThrow();
      }
    }
  });
});

describe('M4 — backup photos are files, never JSON byte-index objects', () => {
  const photo = (seed: number) => {
    const b = new Uint8Array(300 * 1024);
    let x = seed;
    for (let i = 0; i < b.length; i++) b[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 24;
    b.set([0xff, 0xd8, 0xff, 0xe0]);
    b.set([0xff, 0xd9], b.length - 2); // JPEG start and end markers: the reader drops a photo without them (D37)
    return b;
  };
  it('one card with a 300 KB photo: backup.json stays small, the photo is stored once as a file, and reads back', () => {
    const b: BackupCard = { ...card({ number: '123', format: 'code128' }), id: 'p1', tile: 'photo', chainId: null, useCount: 0, sortIndex: 0, createdAt: 1, updatedAt: 1 };
    const front = photo(1);
    const zip = writeBackupZip([{ ...b, images: { front } }], [], 1);
    const entries = readZip(zip);
    const json = utf8.decode(entries['backup.json']);
    expect(json.length).toBeLessThan(2000);
    expect(json).not.toContain('images');
    expect(zip.length).toBeLessThan(front.length + 4000);
    expect(readBackup(zip).cards[0].images.front).toEqual(front);
  });
});

describe('M5 — our Catima export passes Catima importer rules (CatimaImporter.java @07b385d)', () => {
  it('a card without a number is not written (reported instead); non-ISO currency and "12,50" never reach Catima', () => {
    const cards: ExportCard[] = [card({ name: 'Gym (photo only)', number: '', format: 'none', balanceCurrency: 'PTS' }), card({ name: 'Bakery', number: '42', format: 'code128', balance: '12,50', balanceCurrency: 'PTS' }), card({ name: 'Café', number: '43', format: 'code128', balance: '3', balanceCurrency: 'EUR' })];
    const out = writeCatimaZip(cards);
    expect(out.omitted).toEqual([{ index: 0, name: 'Gym (photo only)', reason: 'noNumber' }]);
    const rows = parseCsv(utf8.decode(readZip(out.zip)['catima.csv']));
    const h = rows.findIndex((r) => r[0] === '_id' && r.length > 1);
    const header = rows[h];
    const body = rows.slice(h + 1).filter((r) => r.length === header.length);
    expect(body).toHaveLength(2);
    const col = (r: string[], n: string) => r[header.indexOf(n)];
    for (const r of body) expect(col(r, 'cardid')).not.toBe('');
    expect(body.map((r) => col(r, 'balancetype'))).toEqual(['', 'EUR']);
    expect(body.map((r) => col(r, 'balance'))).toEqual(['12.50', '3']);
  });
  it('the ISO 4217 list is a subset of ICU’s currency list (Android’s Currency is ICU-backed)', () => {
    const icu = new Set((Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('currency'));
    for (const c of ISO_4217) expect({ c, icu: icu.has(c) }).toEqual({ c, icu: true });
    expect(ISO_4217).toContain('EUR');
    expect(ISO_4217).not.toContain('PTS');
  });
  it('a hard export (photo-only card, PTS, "12,50", "lots", lower-case Code 39, multi-line notes, groups, images) passes the Catima importer model', () => {
    const png = renderPng('42', 'code128', 1).png; // real PNG bytes: the writer leaves anything else out (B2 CE-05)
    const cards: ExportCard[] = [
      card({ name: 'Photo only', number: '', format: 'none', categories: ['Fitness'] }),
      { ...card({ name: 'Bakery', number: '42', format: 'code128', balance: '12,50', balanceCurrency: 'PTS', note: 'line 1\n\nline 3 after an EMPTY line, "quoted", comma', categories: ['Food', 'Fitness'] }), images: { front: png, back: png } },
      card({ name: 'Library', number: 'abc-12', format: 'code39', balance: 'lots', balanceCurrency: 'EUR' }),
      card({ name: 'Market', number: '4006381333931', format: 'ean13', balance: '-3.5', balanceCurrency: 'CHF' }),
      card({ name: 'Ticket', number: 'Müller ☃ 日本', format: 'aztec' }),
    ];
    const out = writeCatimaZip(cards, ['Food', 'Fitness']);
    expect(catimaImportProblems(out.zip)).toEqual([]);
    expect(out.omitted.map((o) => o.name)).toEqual(['Photo only']);
    expect(out.dropped).toEqual([
      { index: 1, name: 'Bakery', field: 'balanceCurrency', value: 'PTS' },
      { index: 2, name: 'Library', field: 'balance', value: 'lots' },
    ]);
    // and the bad export of bcc75af would have been refused: the model is not a rubber stamp
    const bad = zipSync({ 'catima.csv': utf8.encode('2\r\n\r\n_id\r\n\r\n_id,store,note,validfrom,expiry,balance,balancetype,cardid\r\n1,Gym,,,,0,PTS,\r\n\r\ncardId,groupId\r\n'), 'notes.txt': new Uint8Array(1) });
    expect(catimaImportProblems(bad)).toEqual(['L87 unexpected file notes.txt', 'L443 card 1: balancetype PTS aborts the import', 'L448 card 1: empty cardid aborts the import']);
    // our own reader gets every exported card back
    expect(readCatima(out.zip).cards.map((c) => c.name)).toEqual(['Bakery', 'Library', 'Market', 'Ticket']);
  });
  it('Catima link: no link for a card without a number', () => {
    expect(buildCatimaShareUrl({ ...card({ number: '' }), unknownType: null })).toBeNull();
  });
});

describe('M6 — 12 digits: UPC-A first, EAN-13 with an appended check digit second (SPEC §5.1)', () => {
  it('ranks the valid UPC-A above the different GTIN', () => {
    expect(suggestFormats('036000291452').slice(0, 2).map((s) => `${s.format}:${s.reason}`)).toEqual(['upca:digitsCheckOk', 'ean13:digitsCheckShown']);
  });
});

describe('S9 — the blind scorer normalises expected values like decoded ones', () => {
  it('Codabar start/stop and UPC-A as EAN-13 are scored ok; a wrong start/stop letter is still caught when both sides carry letters', () => {
    const p = prepare([
      { format: 'codabar', value: 'A1234B', expectDecoded: 'A1234B' },
      { format: 'upca', value: '036000291452', expectDecoded: '036000291452' },
      { format: 'codabar', value: 'A1234B', expectDecoded: 'A1234B' },
    ]);
    const d: Decoded = new Map([
      ['o/3px-bw/0000-codabar.png', [{ value: '1234', symbology: 'VNBarcodeSymbologyCodabar' }]],
      ['o/3px-bw/0001-upca.png', [{ value: '0036000291452', symbology: 'VNBarcodeSymbologyEAN13' }]],
      ['o/3px-bw/0002-codabar.png', [{ value: 'C1234D', symbology: 'VNBarcodeSymbologyCodabar' }]],
    ]);
    const at = (i: number) => score(p, d, 'o', [3], [{ name: 'bw', fg: '#000000', bg: '#ffffff' }])[i].outcome;
    expect([at(0), at(1), at(2)]).toEqual(['ok', 'ok', 'wrongValue']);
  });
});

describe('test-quality fixes', () => {
  it('S2: our own CSV export re-imports unchanged WITHOUT stripping the guard apostrophes by hand', () => {
    const c = { ...card({ name: '=Shop', number: '+12345', format: 'codabar', balance: '-5' }), images: {} };
    const back = parseGenericCsv(writeGenericCsv([c])).cards[0];
    expect(back).toMatchObject({ name: '=Shop', number: '+12345', format: 'codabar', balance: '-5' });
  });
  // hand-written Catima export (not made by our writer): test/fixtures/catima/handwritten/, catima/fixtures.test.ts
});

describe('SHOULDs closed in P4c', () => {
  it('S1: a backup restore keeps manual order and creation time', () => {
    const b: BackupCard = { ...card({ number: '1', format: 'code128' }), id: 'o1', tile: 'initials', chainId: null, useCount: 0, sortIndex: 7, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_001 };
    expect(readBackup(writeBackupZip([b], [], 1)).cards[0]).toMatchObject({ sortIndex: 7, createdAt: 1_700_000_000_000 });
  });
  it('S3: "ID,Name,Card number" takes the card number, not the row id', () => {
    expect(parseGenericCsv('ID,Name,Card number\n1,A,98765432\n2,B,55554444\n').cards.map((c) => c.number)).toEqual(['98765432', '55554444']);
  });
  it('S4: a payload that cannot fit is flagged tooLarge; the note is not blamed when it was not the cause', () => {
    const p = buildSharePayload({ ...card({ name: '🙂'.repeat(80), number: '1', codeValue: '日'.repeat(1000), format: 'qr', note: 'hello' }) });
    expect(p.tooLarge).toBe(true);
    expect(p.noteTruncated).toBe(false);
    expect(buildSharePayload(card({ number: '1', format: 'code128' })).tooLarge).toBe(false);
  });
  it('S5: non-Latin queries are not treated as empty (no unrelated chains for Магнит / ローソン)', () => {
    const ru = searchChains('Магнит', 'RU');
    expect(ru.every((c) => c.name.includes('Магнит') || (c.aliases ?? []).some((a) => a.includes('Магнит')))).toBe(true);
    expect(searchChains('ローソン', 'JP').every((c) => c.name.includes('ローソン') || (c.aliases ?? []).some((a) => a.includes('ローソン')))).toBe(true);
  });
  it('S6: the device region GB gets the British chains', () => {
    expect(searchChains('', 'GB').length).toBeGreaterThanOrEqual(8);
  });
  it('S7: a Catima group name over 40 characters is cut to 40 like the backup reader, links kept', () => {
    const g = 'G'.repeat(60);
    const r = readCatima(utf8.encode(['2', '', '_id', g, '', '_id,store,cardid', '1,Shop,42', '', 'cardId,groupId', `1,${g}`].join('\r\n')));
    expect(r.groups).toEqual(['G'.repeat(40)]);
    expect(r.cards[0].categories).toEqual(['G'.repeat(40)]);
  });
});

// ---- Added by the orchestrator after the B1 first run (677cbd2): defects the review did not predict (N1–N5) and the
// orchestrator's SPEC decisions Q1–Q8 (2026-10-17). B1 is a tuning set from here on; these tests are the repo record.
describe('B1 N1 — 1D bar height has a floor in MODULES (UPC-E at 4 px got ~17 rows)', () => {
  it('layout gives every 1D code at least MIN_BAR_MODULES module rows, at any module size', () => {
    const upce = renderMatrix('06411600', 'upce');
    for (const px of [2, 3, 4, 6]) {
      const w = upce.modulesWide * px;
      const l = layout(upce, { widthPx: w, heightPx: w }, 3);
      expect({ px, rows: Math.floor(l.heightPx / l.modulePx) >= MIN_BAR_MODULES }).toEqual({ px, rows: true });
    }
    expect(MIN_BAR_MODULES).toBeGreaterThanOrEqual(24); // Vision: every short 1D code decodes from 24 rows (P4c measurement)
  });
});

describe('B1 N2 — Code 39/93 and Codabar upper-case ASCII a–z only', () => {
  it('refuses straße, ı, ﬁ, groß instead of converting them', () => {
    for (const [v, f] of [['straße', 'code39'], ['ı', 'code39'], ['ﬁ', 'code39'], ['groß', 'code93']] as const) expect({ v, r: validate(v, f) }).toEqual({ v, r: { ok: false, error: 'chars' } });
    expect(validate('abc-1', 'code39')).toEqual({ ok: true, value: 'ABC-1', notes: ['upperCased'] });
    expect(validate('a12b', 'codabar')).toMatchObject({ ok: true, value: 'A12B' });
  });
});

describe('B1 N3/N4/N5 — own backup: skip over-long names, write links, never default unknown/missing keys', () => {
  const base: BackupCard = { ...card({ number: '1', format: 'code128', categories: ['Food'] }), id: 'k1', tile: 'initials', chainId: null, useCount: 3, sortIndex: 0, createdAt: 1, updatedAt: 1 };
  const json = () => JSON.parse(utf8.decode(readZip(writeBackupZip([base], ['Food'], 1))['backup.json']));
  it('N3: an 81-character name is skipped with a reason, not cut to 80', () => {
    const j = json();
    j.cards[0].name = 'N'.repeat(81);
    const r = readBackup(utf8.encode(JSON.stringify(j)));
    expect(r.cards).toHaveLength(0);
    expect(r.skipped).toEqual([{ row: 1, reason: 'badField', detail: 'name' }]);
  });
  it('N4: backup.json carries `links` (card id → category name)', () => {
    expect(json().links).toEqual([{ cardId: 'k1', category: 'Food' }]);
  });
  it('N5: a card with an unknown key or a missing key is skipped with the key named; nothing is dropped quietly', () => {
    const j = json();
    const { useCount: _u, ...missing } = j.cards[0];
    j.cards = [{ ...j.cards[0], use_count: 3 }, missing];
    const r = readBackup(utf8.encode(JSON.stringify(j)));
    expect(r.cards).toHaveLength(0);
    expect(r.skipped).toEqual([
      { row: 1, reason: 'badField', detail: 'unknown key use_count' },
      { row: 2, reason: 'badField', detail: 'missing key useCount' },
    ]);
  });
});

describe('Q1–Q8 — orchestrator decisions 2026-10-17', () => {
  it('Q1: LC1 colour is optional when reading (writer always writes it)', () => {
    expect(parseSharePayload('LC1:{"n":"Bakery","i":"1001","f":"code128"}')).toMatchObject({ name: 'Bakery', number: '1001', format: 'code128' });
    expect(buildSharePayload(card({ number: '1', format: 'code128' })).text).toContain('"k":"#1f6f43"');
    expect(parseSharePayload('LC1:{"n":"B","i":"1","f":"code128","k":"red"}')).toBeNull(); // present but invalid → still refused
    // B1 LC1-P15 (exposed once the colour became optional): an 81-character name is refused, never cut (like N3)
    expect(parseSharePayload(`LC1:{"n":"${'N'.repeat(81)}","i":"1","f":"code128"}`)).toBeNull();
    expect(parseSharePayload(`LC1:{"n":"${'🙂'.repeat(80)}","i":"1","f":"code128"}`)?.name).toBe('🙂'.repeat(80));
  });
  it('Q3: suggestFormats lists EVERY satisfied format; Code 39/93/Codabar after the numeric formats', () => {
    expect(suggestFormats('ABC-123').map((s) => s.format)).toEqual(['code128', 'code39', 'code93', 'qr', 'aztec', 'pdf417', 'datamatrix']);
    expect(suggestFormats('A1234B').map((s) => s.format)).toEqual(['code128', 'code39', 'code93', 'codabar', 'qr', 'aztec', 'pdf417', 'datamatrix']);
    expect(suggestFormats('4006381333931').map((s) => s.format)).toEqual(['ean13', 'code128', 'code39', 'code93', 'codabar', 'qr', 'aztec', 'pdf417', 'datamatrix']);
    expect(suggestFormats('036000291452').map((s) => s.format).slice(0, 4)).toEqual(['upca', 'ean13', 'code128', 'itf']);
  });
  it('Q4: a Catima link with an unknown type gets the "Catima type: X" note from the engine', () => {
    expect(parseCatimaShareUrl('https://catima.app/share#store%3DParcel%26note%3D%26cardid%3DM1%26barcodetype%3DMAXICODE')).toMatchObject({ format: 'none', note: 'Catima type: MAXICODE', unknownType: 'MAXICODE' });
  });
  it('Q5: "Food" and "food" are one category, first spelling wins (Catima, backup, CSV)', () => {
    const csv = ['2', '', '_id', 'Food', 'food', 'Drinks', '', '_id,store,cardid,barcodetype', '1,Alpha,A-1,CODE_128', '2,Beta,B-2,CODE_128', '', 'cardId,groupId', '1,Food', '1,food', '2,food'].join('\r\n');
    const r = readCatima(utf8.encode(csv));
    expect(r.groups).toEqual(['Food', 'Drinks']);
    expect(r.cards.map((c) => c.categories)).toEqual([['Food'], ['Food']]);
    expect(parseGenericCsv('name,number,categories\nA,1,Food; food\nB,2,FOOD\n').cards.map((c) => c.categories)).toEqual([['Food'], ['Food']]);
  });
  it('Q6: only spaces and hyphens separate EAN/UPC digits; "." is a charset error', () => {
    expect(validate('4006381333931.0', 'ean13')).toEqual({ ok: false, error: 'chars' });
    expect(validate('4006-3813 3393 1', 'ean13')).toMatchObject({ ok: true, value: '4006381333931' });
  });
  it('Q7: Codabar "AB" (empty body) is a length error', () => {
    expect(validate('AB', 'codabar')).toEqual({ ok: false, error: 'length' });
  });
  it('Q8: "more than 1,000 characters" and "does not fit this code" are two reasons', () => {
    expect(validate('x'.repeat(1001), 'qr')).toEqual({ ok: false, error: 'tooLong' });
    expect(validate('日'.repeat(1000), 'qr')).toEqual({ ok: false, error: 'capacity' });
  });
});

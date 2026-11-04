/**
 * @jest-environment node
 */
import { BackupFormatError, checkBackupCard, readBackup } from './backup/reader';
import { writeBackupZip, type BackupCard } from './backup/writer';
import { emptyCardData, type ImportedCard } from './card-data';
import { CHAINS, chainById, fold, searchChains } from './chains';
import { csvField, detectDelimiter, parseCsv, writeCsv } from './csv-core';
import { dateMs, guardCell, parseGenericCsv, writeGenericCsv } from './csv';
import { expiryState, formatBalance, groupNumber, initials, textColorOn } from './format';
import { planImport } from './import-plan';
import { foldText, searchCards, searchKey } from './search';
import { buildSharePayload, parseSharePayload, SHARE_MAX_BYTES } from './share-payload';
import { mostUsed, sortCards } from './sort';
import { buildSnapshot } from './widgets';
import { isZip, readZip, utf8, writeZip, zipEncryption } from './zip';

describe('csv-core (RFC 4180)', () => {
  it('parses quotes, embedded delimiters, line breaks, BOM and CRLF; writes them back', () => {
    const text = '﻿a,b,c\r\n1,"x, y","multi\r\nline"\r\n"say ""hi""",,\r\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', 'multi\r\nline'],
      ['say "hi"', '', ''],
    ]);
    expect(parseCsv('a;b\n1;2', { delimiter: ';' })).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('x')).toEqual([['x']]);
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField(' lead')).toBe('" lead"');
    const rows = [['n', 'v'], ['x"y', 'a\nb']];
    expect(parseCsv(writeCsv(rows))).toEqual(rows);
    expect(detectDelimiter('a;b;c')).toBe(';');
    expect(detectDelimiter('a\tb')).toBe('\t');
    expect(detectDelimiter('a,b')).toBe(',');
  });
});

describe('generic CSV import/export (SPEC §5.4)', () => {
  it('detects headers, delimiter, BOM; maps loose type names; unknown format → suggestion; skips bad rows', () => {
    const text = '﻿Store;Card ID;Barcode Type;Notes;Groups\r\nNordmarkt;4006381333931;EAN13;hello;Food|Fuel\r\nKiosk;ABC-12;Code 39;;\r\nMystery;96385074;;;\r\nWeird;999;FOOBAR;;\r\n;123;;;\r\nNoNumber;;;;\r\n';
    const r = parseGenericCsv(text);
    expect(r.delimiter).toBe(';');
    expect(r.cards.map((c) => [c.name, c.number, c.format])).toEqual([
      ['Nordmarkt', '4006381333931', 'ean13'],
      ['Kiosk', 'ABC-12', 'code39'],
      ['Mystery', '96385074', 'ean8'],
      ['Weird', '999', 'code128'],
    ]);
    expect(r.cards[0].categories).toEqual(['Food', 'Fuel']);
    expect(r.cards[3].note).toBe('Type: FOOBAR');
    expect(r.skipped).toEqual([
      { row: 6, reason: 'emptyName' },
      { row: 7, reason: 'emptyNumber' },
    ]);
  });
  it('without a recognised header the file is refused (columns were guessed until B2, D37)', () => {
    expect(() => parseGenericCsv('Shop,123,QR_CODE,note\nOther,456\n')).toThrow('noHeader');
  });
  it('export → import round trip keeps the fields; formula cells are guarded', () => {
    const card: ImportedCard = { ...emptyCardData(), name: '=SUM(A1)', number: '+123', codeValue: 'C1', format: 'code128', color: '#1f6f43', note: '-x\n@y', balance: '5', balanceCurrency: 'EUR', validFrom: dateMs('2026-01-02'), expiry: dateMs('2027-03-04'), favourite: true, archived: false, categories: ['A', 'B'], images: {} };
    const csv = writeGenericCsv([card]);
    expect(csv.split('\r\n')[1].startsWith("'=SUM(A1),'+123,")).toBe(true);
    expect(guardCell('normal')).toBe('normal');
    const back = parseGenericCsv(csv.replace(/'(?=[=+\-@])/g, '')); // a spreadsheet shows the guarded text; we re-import the raw values
    expect(back.cards[0]).toMatchObject({ name: '=SUM(A1)', number: '+123', codeValue: 'C1', format: 'code128', color: '#1f6f43', note: '-x\n@y', balance: '5', balanceCurrency: 'EUR', validFrom: dateMs('2026-01-02'), expiry: dateMs('2027-03-04'), favourite: true, categories: ['A', 'B'] });
  });
});

describe('share payload (LC1, D18)', () => {
  it('round-trips and stays ≤ 1,200 bytes with the note truncated and flagged', () => {
    const card = { ...emptyCardData(), name: 'Käse & Wein', number: '4006381333931', codeValue: 'X', format: 'code128' as const, color: '#1f6f43', note: 'n', balance: '1.5', balanceCurrency: 'EUR', expiry: 1_800_000_000_000, validFrom: 1_700_000_000_000 };
    const p = buildSharePayload(card);
    expect(p.text.startsWith('LC1:{')).toBe(true);
    expect(p.noteTruncated).toBe(false);
    expect(parseSharePayload(p.text)).toEqual({ ...card, favourite: false, archived: false, lastUsedAt: null, categories: [] });
    const long = buildSharePayload({ ...card, note: '日本語'.repeat(800) });
    expect(long.bytes).toBeLessThanOrEqual(SHARE_MAX_BYTES);
    expect(long.noteTruncated).toBe(true);
    expect(parseSharePayload(long.text)?.note.endsWith('…')).toBe(true);
    expect(parseSharePayload('LC1:{"n":"x"}')).toBeNull();
    expect(parseSharePayload('LC1:{"n":"x","i":"1","f":"maxicode","k":"#000000"}')).toBeNull();
    expect(parseSharePayload('https://catima.app/share#x')).toBeNull();
    expect(parseSharePayload('LC1:not json')).toBeNull();
  });
});

describe('own backup (SPEC §5.4)', () => {
  const card: BackupCard = { ...emptyCardData(), id: 'c1', name: 'Nordmarkt', number: '123', codeValue: '', format: 'code128', color: '#1f6f43', note: 'n', tile: 'photo', chainId: 'de-rewe', useCount: 7, sortIndex: 2, createdAt: 1, updatedAt: 2, favourite: true, categories: ['Food'] };
  it('writes backup.json + photos and reads every field back; invalid rows are skipped with the field name', () => {
    const zip = writeBackupZip([{ ...card, images: { front: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 0xff, 0xd9]) } }, { ...card, id: 'c2', name: 'Two' }], ['Food', 'Empty'], 5000);
    expect(isZip(zip)).toBe(true);
    const entries = readZip(zip);
    expect(Object.keys(entries).sort()).toEqual(['backup.json', 'cards/c1/front.jpg']);
    const back = readBackup(zip);
    expect(back.exportedAt).toBe(5000);
    expect(back.categories).toEqual(['Food', 'Empty']);
    expect(back.cards).toHaveLength(2);
    expect(back.cards[0]).toMatchObject({ name: 'Nordmarkt', tile: 'photo', chainId: 'de-rewe', useCount: 7, favourite: true, categories: ['Food'] });
    expect(back.cards[0].images.front).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 0xff, 0xd9]));
    expect(back.cards[1].images.front).toBeUndefined();
    const json = JSON.parse(utf8.decode(entries['backup.json']));
    json.cards.push({ ...card, id: 'bad', color: 'red' }, { ...card, id: 'bad2', format: 'maxicode' }, { ...card, id: 'bad3', name: '' }, { ...card, id: 'bad4', expiry: 'tomorrow' });
    const r = readBackup(utf8.encode(JSON.stringify(json)));
    expect(r.cards).toHaveLength(2);
    expect(r.skipped).toEqual([
      { row: 3, reason: 'badField', detail: 'color' },
      { row: 4, reason: 'badField', detail: 'format' },
      { row: 5, reason: 'badField', detail: 'name' },
      { row: 6, reason: 'badField', detail: 'expiry' },
    ]);
    expect(checkBackupCard(null)).toEqual({ bad: 'card' });
    expect(() => readBackup(utf8.encode('{"version":2,"cards":[]}'))).toThrow(BackupFormatError);
    expect(() => readBackup(utf8.encode('nope'))).toThrow('notBackup');
    expect(() => readBackup(writeZip({ 'x.txt': new Uint8Array(1) }))).toThrow('noJson');
    expect(zipEncryption(writeZip({ 'a.txt': new Uint8Array([1]) }))).toBe('none');
  });
});

describe('import plan (never overwrites, exact summary A13)', () => {
  it('12 valid, 2 skipped, 1 duplicate → 12 imported, 2 skipped, 1 duplicate skipped', () => {
    const mk = (n: number): ImportedCard => ({ ...emptyCardData(), name: `C${n}`, number: String(n), format: 'code128', images: {} });
    const cards = [...Array.from({ length: 12 }, (_, i) => mk(i)), mk(5)];
    const plan = planImport(cards, [{ number: '5', format: 'code128' }], [{ row: 2, reason: 'emptyName' }, { row: 9, reason: 'emptyNumber' }]);
    expect(plan.summary).toEqual({ imported: 11, skipped: 2, duplicates: 2 }); // '5' exists already AND appears twice in the file
    const plan2 = planImport(cards.slice(0, 12), [{ number: '5', format: 'code128' }], [{ row: 2, reason: 'emptyName' }, { row: 9, reason: 'emptyNumber' }]);
    expect(plan2.summary).toEqual({ imported: 11, skipped: 2, duplicates: 1 });
    expect(planImport(cards.slice(0, 12), [{ number: '5', format: 'code128' }], [], 'keepBoth').summary).toEqual({ imported: 12, skipped: 0, duplicates: 0 });
    expect(planImport(cards.slice(0, 12), [{ number: '5', format: 'ean13' }], []).summary.duplicates).toBe(0); // same number, other format
  });
});

describe('chains (SPEC §5.5)', () => {
  it('has ≥ 250 unique chains with the country minimums and valid colours/formats', () => {
    expect(CHAINS.length).toBeGreaterThanOrEqual(250);
    expect(new Set(CHAINS.map((c) => c.id)).size).toBe(CHAINS.length);
    const count = (cc: string) => CHAINS.filter((c) => c.countries.includes(cc)).length;
    expect(count('DE') + count('AT') + count('CH')).toBeGreaterThanOrEqual(80);
    expect(count('GB')).toBeGreaterThanOrEqual(30); // ISO alpha-2 (review S6)
    expect(count('US')).toBeGreaterThanOrEqual(40);
    for (const cc of ['FR', 'IT', 'ES', 'NL', 'PL', 'PT', 'BR', 'TR', 'ID', 'IN', 'JP', 'KR', 'VN', 'RU', 'MX']) expect({ cc, n: count(cc) >= 5 }).toEqual({ cc, n: true });
    for (const c of CHAINS) {
      expect(c.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.id).toMatch(/^[a-z]{2}-[a-z0-9-]+$/);
    }
  });
  it('searches by prefix, word, alias and substring; the user country first', () => {
    expect(searchChains('rew', 'DE')[0].id).toBe('de-rewe');
    expect(searchChains('mull', 'DE')[0].id).toBe('de-mueller');
    expect(searchChains('müll', 'DE')[0].id).toBe('de-mueller');
    expect(searchChains('cumulus', 'CH')[0].id).toBe('ch-migros');
    expect(searchChains('tesco')[0].id).toBe('uk-tesco');
    expect(searchChains('clubcard')[0].id).toBe('uk-tesco');
    expect(searchChains('h&m')[0].id).toBe('de-hm');
    expect(searchChains('payback', 'AT')[0].id).toBe('de-payback');
    expect(searchChains('', 'AT').every((c) => c.countries.includes('AT'))).toBe(true);
    expect(searchChains('zzzz')).toEqual([]);
    expect(chainById('de-rewe')?.format).toBe('ean13');
    expect(chainById('nope')).toBeUndefined();
    expect(fold('Müller-Straße')).toBe('muller strasse');
    expect(fold('Магнит')).toBe('магнит');
    expect(fold('Sainsbury’s')).toBe('sainsbury s');
    expect(searchChains('', 'UK')).toEqual(searchChains('', 'GB'));
  });
});

describe('sort / search / format / widgets', () => {
  const mk = (id: string, o: Partial<{ name: string; favourite: boolean; sortIndex: number; useCount: number; lastUsedAt: number | null; archived: boolean; number: string; note: string }>) => ({ id, name: id, favourite: false, sortIndex: 0, useCount: 0, lastUsedAt: null, createdAt: 0, archived: false, color: '#000000', format: 'qr', number: '', note: '', ...o });
  it('sorts with favourites first in every mode', () => {
    const cards = [mk('b', { sortIndex: 1, useCount: 5, lastUsedAt: 50 }), mk('a', { sortIndex: 2, useCount: 9, lastUsedAt: 10 }), mk('ä', { sortIndex: 0, favourite: true, useCount: 1, lastUsedAt: 99 }), mk('c10', { sortIndex: 3 }), mk('c9', { sortIndex: 4 })];
    expect(sortCards(cards, 'manual').map((c) => c.id)).toEqual(['ä', 'b', 'a', 'c10', 'c9']);
    expect(sortCards(cards, 'name', 'de').map((c) => c.id)).toEqual(['ä', 'a', 'b', 'c9', 'c10']);
    expect(sortCards(cards, 'most_used').map((c) => c.id)).toEqual(['ä', 'a', 'b', 'c10', 'c9']);
    expect(sortCards(cards, 'recent').map((c) => c.id)).toEqual(['ä', 'b', 'a', 'c10', 'c9']);
    expect(mostUsed([...cards, mk('z', { useCount: 100, archived: true })], 2).map((c) => c.id)).toEqual(['a', 'b']);
  });
  it('search is diacritic/case-insensitive over name, number, note, categories and fast for 500 cards', () => {
    const cards = Array.from({ length: 500 }, (_, i) => ({ name: `Shop ${i}`, number: `${100000 + i}`, note: i === 7 ? 'Zürich Café' : '', categoryNames: i % 50 === 0 ? ['Reisen'] : [] }));
    expect(searchCards(cards, 'zurich cafe').map((c) => c.name)).toEqual(['Shop 7']);
    expect(searchCards(cards, 'REISEN')).toHaveLength(10);
    expect(searchCards(cards, '100042').map((c) => c.name)).toEqual(['Shop 42']);
    expect(searchCards(cards, '')).toHaveLength(500);
    const keys = cards.map(searchKey);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) searchCards(cards, 'shop 4', keys);
    expect((performance.now() - t0) / 20).toBeLessThan(50);
    expect(foldText('Straße Ø')).toBe('strasse ø');
  });
  it('formats balance, expiry state, grouped numbers, initials and text colour', () => {
    expect(formatBalance('12.50', 'EUR', 'de')).toBe('12,50 EUR');
    expect(formatBalance('150', '', 'en')).toBe('150');
    expect(formatBalance('', 'EUR')).toBe('');
    expect(expiryState(null, 0)).toEqual({ state: 'none', days: null });
    expect(expiryState(10 * 86_400_000, 0)).toEqual({ state: 'soon', days: 10 });
    expect(expiryState(40 * 86_400_000, 0)).toEqual({ state: 'ok', days: 40 });
    expect(expiryState(0, 86_400_000)).toEqual({ state: 'expired', days: -1 });
    expect(groupNumber('4006381333931')).toBe('4006 3813 3393 1');
    expect(groupNumber('123456789')).toBe('123456789');
    expect(groupNumber('ABC-123')).toBe('ABC-123');
    expect(initials('Kaffeehaus Lila')).toBe('KL');
    expect(initials('dm')).toBe('DM');
    expect(initials('Çağdaş Market')).toBe('ÇM');
    expect(textColorOn('#ffffff')).toBe('#000000');
    expect(textColorOn('#1f6f43')).toBe('#ffffff');
  });
  it('widget snapshot: chosen ids, then favourites, then most used, max 8, no archived', () => {
    const cards = [mk('x', { useCount: 9 }), mk('f', { favourite: true }), mk('arch', { archived: true, favourite: true }), ...Array.from({ length: 10 }, (_, i) => mk(`n${i}`, { useCount: i }))];
    const s = buildSnapshot(cards, ['n3', 'missing', 'n3'], 123, (c) => (c.id === 'x' ? 'widgets/x.png' : undefined));
    expect(s.cards.map((c) => c.id)).toEqual(['n3', 'f', 'x', 'n9', 'n8', 'n7', 'n6', 'n5']);
    expect(s.cards[2].pngPath).toBe('widgets/x.png');
    expect(s.cards[0].pngPath).toBeUndefined();
    expect(s.updatedAt).toBe(123);
  });
});

/**
 * @jest-environment node
 */
// Regression tests for docs/REVIEW_ENGINE.md R1–R6, R8, R9.
import { renderPng } from './barcode/png';
import { renderSvg } from './barcode/svg';
import { cleanBalance, cleanTimestampMs } from './card-data';
import { parseCatimaCsv } from './catima/reader';
import { parseSharePayload } from './share-payload';
import { readZip, utf8, writeZip, ZIP_ENCRYPTED, zipEncryption } from './zip';

describe('review fixes', () => {
  it('R2: encryption on a LATER entry is detected and reported as password-protected', () => {
    const plain = writeZip({ 'catima.csv': utf8.encode('2\r\n'), 'card_1_front.png': new Uint8Array([1, 2, 3]) });
    expect(zipEncryption(plain)).toBe('none');
    // flip the encryption flag of the second local header
    let off = 30 + 'catima.csv'.length + (plain[26 + 28] | (plain[29] << 8));
    off += plain[18] | (plain[19] << 8) | (plain[20] << 16) | (plain[21] << 24);
    expect([plain[off], plain[off + 1], plain[off + 2], plain[off + 3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const tampered = new Uint8Array(plain);
    tampered[off + 6] |= 1;
    expect(zipEncryption(tampered)).toBe('encrypted');
    expect(() => readZip(tampered)).toThrow(ZIP_ENCRYPTED);
    expect(Object.keys(readZip(plain)).sort()).toEqual(['card_1_front.png', 'catima.csv']);
  });

  it('R3: a seconds timestamp in an ms field is promoted; real ms values are untouched', () => {
    expect(cleanTimestampMs('1800000000')).toBe(1_800_000_000_000);
    expect(cleanTimestampMs('1800000000000')).toBe(1_800_000_000_000);
    expect(cleanTimestampMs('1700000000', 's')).toBe(1_700_000_000_000);
    expect(cleanTimestampMs('0')).toBeNull();
    expect(cleanTimestampMs('x')).toBeNull();
  });

  it('R4: a zero balance imports as none; real balances stay', () => {
    expect(cleanBalance('0')).toBe('');
    expect(cleanBalance('0.00')).toBe('');
    expect(cleanBalance('-0')).toBe('');
    expect(cleanBalance('0.5')).toBe('0.5');
    expect(cleanBalance('12,50')).toBe('12.50');
    const r = parseCatimaCsv('2\n\n_id\n\nstore,cardid,balance\nA,1,0\nB,2,7.25\n\ncardId,groupId\n');
    expect(r.cards.map((c) => c.balance)).toEqual(['', '7.25']);
  });

  it('R6: a share payload colour must be lower-case #rrggbb (upper case accepted until B2, refused since D38)', () => {
    expect(parseSharePayload('LC1:{"n":"x","i":"1","f":"code128","k":"#1f6f43"}')?.color).toBe('#1f6f43');
    expect(parseSharePayload('LC1:{"n":"x","i":"1","f":"code128","k":"#1F6F43"}')).toBeNull();
    expect(parseSharePayload('LC1:{"n":"x","i":"1","f":"code128","k":"#1F6F4"}')).toBeNull();
  });

  it('R8: over-long store names are truncated to 80 and counted, not dropped', () => {
    const r = parseCatimaCsv(`2\n\n_id\n\nstore,cardid\n${'x'.repeat(100)},1\nShort,2\n\ncardId,groupId\n`);
    expect(r.cards[0].name).toHaveLength(80);
    expect(r.truncatedNames).toBe(1);
    expect(r.cards).toHaveLength(2);
  });

  it('R9: renderSvg / renderPng wrappers return the module counts', () => {
    const s = renderSvg('4006381333931', 'ean13', { modulePx: 3, barHeightPx: 90 });
    expect(s.modulesWide).toBe(113);
    expect(s.svg).toContain('<svg');
    const p = renderPng('hello', 'qr', 4);
    expect(p.modulesWide).toBe(29);
    expect(p.widthPx).toBe(29 * 4);
  });
});

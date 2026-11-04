// A24 / A25 (B2 ambiguities, orchestrator decisions 2026-10-26, D39): Catima group names are cut to 40 CODE POINTS (never
// UTF-16 units, which could split a surrogate pair and disagree with SQLite's length() CHECK); `barcodetype` is matched
// case-insensitively.
import { cleanCategoryName } from '@/db/categories';

import { readCatima } from './catima/reader';
import { utf8 } from './zip';

const csv = (group: string, type = 'EAN_13'): Uint8Array =>
  utf8.encode(
    [
      '2',
      '',
      '_id',
      group,
      '',
      '_id,store,note,validfrom,expiry,balance,balancetype,cardid,barcodeid,barcodetype,barcodeencoding,headercolor,starstatus,lastused,archive',
      `1,Shop,,,,0,,4006381333931,,${type},,-1,0,0,0`,
      '',
      'cardId,groupId',
      `1,${group}`,
      '',
    ].join('\r\n'),
  );

describe('A24: Catima group names are cut by code points', () => {
  it('41 emoji → 40 emoji, no lone surrogate, accepted by the category rule', () => {
    const r = readCatima(csv('🍎'.repeat(41)));
    expect(r.groups).toEqual(['🍎'.repeat(40)]);
    expect(r.cards[0].categories).toEqual(['🍎'.repeat(40)]);
    expect(cleanCategoryName('🍎'.repeat(40))).toBe('🍎'.repeat(40));
    expect(() => cleanCategoryName('🍎'.repeat(41))).toThrow();
  });
  it('ASCII names are unchanged (40 kept, 41 cut)', () => {
    expect(readCatima(csv('a'.repeat(41))).groups).toEqual(['a'.repeat(40)]);
  });
});

describe('A25: barcodetype is matched case-insensitively', () => {
  it.each(['EAN_13', 'ean_13', 'Ean_13', ' ean_13 '])('%s → ean13 without a "Catima type" note', (t) => {
    const card = readCatima(csv('G', t)).cards[0];
    expect(card.format).toBe('ean13');
    expect(card.note).not.toContain('Catima type');
  });
});

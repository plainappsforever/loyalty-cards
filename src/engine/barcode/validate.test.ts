import { expandUpcE, gs1CheckDigit } from './check-digit';
import { formatFromCatima, formatFromHint, FORMATS, FORMAT_IDS } from './formats';
import { normalise, splitCodabar, suggestFormats, validate, validFormatsFor } from './validate';

describe('formats table', () => {
  it('covers every stored id with the names other systems use', () => {
    for (const id of FORMAT_IDS) expect(FORMATS[id].id).toBe(id);
    expect(formatFromCatima('CODE_128')).toBe('code128');
    expect(formatFromCatima('maxicode')).toBeUndefined();
    expect(formatFromHint('itf14')).toBe('itf');
    expect(formatFromHint('VNBarcodeSymbologyEAN13')).toBe('ean13');
    expect(formatFromHint('org.gs1.EAN-13')).toBe('ean13');
    expect(formatFromHint('Code 128')).toBe('code128');
    expect(formatFromHint('upc-a')).toBe('upca');
    expect(formatFromHint('QR_CODE')).toBe('qr');
    expect(formatFromHint('nope')).toBeUndefined();
  });
});

describe('validate (SPEC §5.1) — never auto-corrects', () => {
  it('EAN-13: 13 digits with GS1 check; 12 digits → the check digit is offered, not appended', () => {
    expect(validate('4006381333931', 'ean13')).toEqual({ ok: true, value: '4006381333931', notes: [] });
    expect(validate('4006381333931'.slice(0, 12), 'ean13')).toEqual({ ok: false, error: 'length', suggestion: { value: '4006381333931', reason: 'addCheckDigit', detail: '1' } });
    expect(validate('4006381333937', 'ean13')).toEqual({ ok: false, error: 'checkDigit', suggestion: { value: '4006381333931', reason: 'fixCheckDigit', detail: '1' } });
    expect(validate('4006 3813 3393 1', 'ean13')).toEqual({ ok: true, value: '4006381333931', notes: ['separatorsRemoved'] });
    expect(validate('40063813339A1', 'ean13')).toEqual({ ok: false, error: 'chars' });
    expect(validate('', 'ean13')).toEqual({ ok: false, error: 'empty' });
  });
  it('UPC-E: number system 0/1, check via expansion (Price Book twin logic)', () => {
    expect(validate('01234565', 'upce')).toEqual({ ok: true, value: '01234565', notes: [] });
    expect(expandUpcE('01234565')).toBe('012345000065'); // d6 = 5 → d1..d5 0000 d6
    expect(gsCheck('01234500006')).toBe('5');
    expect(expandUpcE('01234525')).toBe('012200003455'); // d6 = 2 → d1 d2 d6 0000 d3 d4 d5
    expect(validate('21234565', 'upce')).toEqual({ ok: false, error: 'numberSystem' });
    expect(validate('0123456', 'upce')).toMatchObject({ ok: false, error: 'length', suggestion: { reason: 'addCheckDigit', value: '01234565' } });
    expect(validate('01234560', 'upce')).toMatchObject({ ok: false, error: 'checkDigit', suggestion: { value: '01234565' } });
  });
  it('ITF: even digits ≥ 4; odd → leading zero offered', () => {
    expect(validate('1234', 'itf').ok).toBe(true);
    expect(validate('12345', 'itf')).toEqual({ ok: false, error: 'length', suggestion: { value: '012345', reason: 'addLeadingZero', detail: '0' } });
    expect(validate('12', 'itf')).toEqual({ ok: false, error: 'length' });
    expect(validate('1'.repeat(42), 'itf')).toEqual({ ok: false, error: 'tooLong' });
  });
  it('Codabar: start/stop both or none; lower case upper-cased with a note', () => {
    expect(validate('A12-34B', 'codabar')).toEqual({ ok: true, value: 'A12-34B', notes: [] });
    expect(validate('a12$34d', 'codabar')).toEqual({ ok: true, value: 'A12$34D', notes: ['upperCased'] });
    expect(validate('12:34/56', 'codabar')).toEqual({ ok: true, value: '12:34/56', notes: [] });
    expect(validate('A1234', 'codabar')).toEqual({ ok: false, error: 'startStop' });
    expect(validate('A1B', 'codabar')).toEqual({ ok: false, error: 'length' }); // 1-char body: readers cannot decode it (D30)
    expect(validate('7', 'codabar')).toEqual({ ok: false, error: 'length' });
    expect(validate('A12B', 'codabar').ok).toBe(true);
    expect(validate('A12E4B', 'codabar')).toEqual({ ok: false, error: 'chars' });
    expect(splitCodabar('C99D')).toEqual({ start: 'C', stop: 'D', body: '99' });
    expect(splitCodabar('A')).toEqual({ start: 'A', stop: null, body: '' });
  });
  it('Code 39/93: charset, upper-casing; Code 128: printable ASCII ≤ 80', () => {
    expect(validate('abc-123', 'code39')).toEqual({ ok: true, value: 'ABC-123', notes: ['upperCased'] });
    expect(validate('ABC*1', 'code39')).toEqual({ ok: false, error: 'chars' });
    expect(validate('abc.1 %', 'code93')).toEqual({ ok: true, value: 'ABC.1 %', notes: ['upperCased'] });
    expect(validate('Hello, World! #42', 'code128')).toEqual({ ok: true, value: 'Hello, World! #42', notes: [] });
    expect(validate('Müller', 'code128')).toEqual({ ok: false, error: 'chars' });
    expect(validate('a\tb', 'code128')).toEqual({ ok: false, error: 'chars' });
    expect(validate('x'.repeat(81), 'code128')).toEqual({ ok: false, error: 'tooLong' });
  });
  it('2D: ≤ 1,000 characters AND within the symbol byte capacity (D32); none: anything ≤ 200', () => {
    expect(validate('Müller ☃ 日本 🙂', 'qr')).toEqual({ ok: true, value: 'Müller ☃ 日本 🙂', notes: [] });
    expect(validate('🙂'.repeat(477), 'aztec').ok).toBe(true); // 1,908 UTF-8 bytes + ECI 26: the largest Aztec symbol
    expect(validate('🙂'.repeat(478), 'aztec')).toEqual({ ok: false, error: 'capacity' }); // was accepted up to 1,000 before review M3
    expect(validate('x'.repeat(1001), 'pdf417')).toEqual({ ok: false, error: 'tooLong' });
    expect(validate(' keep inner  spaces ', 'datamatrix')).toEqual({ ok: true, value: 'keep inner  spaces', notes: [] });
    expect(validate('', 'none')).toEqual({ ok: true, value: '', notes: [] });
    expect(validate('x'.repeat(201), 'none')).toEqual({ ok: false, error: 'tooLong' });
  });
  it('normalise never touches 2D text beyond trimming', () => {
    expect(normalise('  Ab  ', 'qr')).toEqual({ value: 'Ab', notes: [] });
    expect(normalise('12-34', 'ean8')).toEqual({ value: '1234', notes: ['separatorsRemoved'] });
  });
});

function gsCheck(s: string) {
  return gs1CheckDigit(s);
}

describe('suggestFormats', () => {
  const ids = (raw: string, hint?: string) => suggestFormats(raw, hint).map((s) => `${s.format}:${s.reason}`);
  it('13 digits with a valid check → EAN-13 first, then Code 128 (odd → no ITF), Code 39/93, Codabar, the 2D codes (D33 Q3)', () => {
    expect(ids('4006381333931')).toEqual(['ean13:digitsCheckOk', 'code128:printableAscii', 'code39:charsetOk', 'code93:charsetOk', 'codabar:charsetOk', 'qr:anyText', 'aztec:anyText', 'pdf417:anyText', 'datamatrix:anyText']);
  });
  it('12 digits → UPC-A when its check holds FIRST, then EAN-13 with the check digit shown (SPEC §5.1; review M6 fixed the old order)', () => {
    expect(ids('036000291452')).toEqual(['upca:digitsCheckOk', 'ean13:digitsCheckShown', 'code128:printableAscii', 'itf:evenDigits', 'code39:charsetOk', 'code93:charsetOk', 'codabar:charsetOk', 'qr:anyText', 'aztec:anyText', 'pdf417:anyText', 'datamatrix:anyText']);
    expect(ids('036000291453')).toEqual(['ean13:digitsCheckShown', 'code128:printableAscii', 'itf:evenDigits', 'code39:charsetOk', 'code93:charsetOk', 'codabar:charsetOk', 'qr:anyText', 'aztec:anyText', 'pdf417:anyText', 'datamatrix:anyText']); // UPC-A check fails → only the shown EAN-13
    expect(suggestFormats('036000291452').find((s) => s.format === 'ean13')?.value).toBe(`036000291452${gsCheck('036000291452')}`);
  });
  it('8 digits: EAN-8 and UPC-E twins both offered when both checks hold', () => {
    const twins = ids('01234565');
    expect(twins[0]).toMatch(/^(ean8|upce):/);
    expect(twins.filter((t) => t.startsWith('ean8:') || t.startsWith('upce:'))).toEqual(['ean8:digitsCheckOk', 'upce:twin']); // both checks hold → twins
    expect(gsCheck('0123456')).toBe('5');
    expect(ids('96385074').filter((t) => t.startsWith('ean8:') || t.startsWith('upce:'))).toEqual(['ean8:digitsCheckOk']); // UPC-E check fails → no twin
  });
  it('the scanner hint goes first when the value is valid for it', () => {
    expect(ids('1234567890', 'itf14')[0]).toBe('itf:scanner');
    expect(ids('HELLO', 'code39')[0]).toBe('code39:scanner');
    expect(ids('hello', 'code39')[0]).toBe('code39:scanner'); // upper-cased value offered
    expect(ids('HELLO', 'ean13')[0]).toBe('code128:printableAscii'); // hint does not fit → ignored
  });
  it('anything else → the 2D codes; over-long text → none', () => {
    expect(ids('Müller & Söhne')).toEqual(['qr:anyText', 'aztec:anyText', 'pdf417:anyText', 'datamatrix:anyText']);
    expect(ids('x'.repeat(1001))).toEqual(['none:anyText']);
    expect(validFormatsFor('ABC-123')).toEqual(['code128', 'code39', 'code93', 'qr', 'aztec', 'pdf417', 'datamatrix']);
  });
});

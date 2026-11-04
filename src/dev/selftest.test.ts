/**
 * @jest-environment node
 */
import { A3_ROWS, brightnessCheck, imageCheck, sameFormat, summary, textChecks, timeRow } from './selftest';
import { SELFTEST_IMAGES } from './selftest-cases';

const img = (file: string) => SELFTEST_IMAGES.find((i) => i.file === file)!;

describe('self-test logic (the device runs the same functions on Hermes)', () => {
  it('A6: Vision and ML Kit names both map to the expected format; UPC-A read as EAN-13 + leading 0 counts', () => {
    expect(imageCheck(img('ean13.png'), [{ value: '4006381333931', format: 'VNBarcodeSymbologyEAN13' }]).ok).toBe(true);
    expect(imageCheck(img('ean13.png'), [{ value: '4006381333931', format: 'ean13' }]).ok).toBe(true);
    expect(imageCheck(img('upca.png'), [{ value: '0036000291452', format: 'VNBarcodeSymbologyEAN13' }]).ok).toBe(true);
    expect(imageCheck(img('upca.png'), [{ value: '036000291452', format: 'upca' }]).ok).toBe(true);
    expect(imageCheck(img('codabar.png'), [{ value: '21234567890123', format: 'codabar' }]).ok).toBe(true);
    expect(imageCheck(img('codabar-short.png'), [])).toMatchObject({ ok: false, reportOnly: true });
    expect(imageCheck(img('itf.png'), [{ value: '12345678901231', format: 'VNBarcodeSymbologyI2of5' }]).ok).toBe(true);
  });
  it('A6: a wrong value, a wrong format or a missing second code fails', () => {
    expect(imageCheck(img('ean13.png'), [{ value: '4006381333932', format: 'ean13' }]).ok).toBe(false);
    expect(imageCheck(img('ean13.png'), [{ value: '4006381333931', format: 'code128' }]).ok).toBe(false);
    expect(imageCheck(img('two-codes.png'), [{ value: '5901234123457', format: 'ean13' }]).ok).toBe(false);
    expect(imageCheck(img('two-codes.png'), [{ value: 'MEMBER 778-221', format: 'qr' }, { value: '5901234123457', format: 'ean13' }]).ok).toBe(true);
    expect(imageCheck(img('qr.png'), []).detail).toBe('(nothing decoded)');
  });
  it('sameFormat does not let EAN-13 stand in for UPC-A without the leading 0', () => {
    expect(sameFormat('upca', 'ean13', '1036000291452')).toBe(false);
  });
  it('A7: within 0.02 of 1 while set and of the start value after restore', () => {
    expect(brightnessCheck(0.5, 1, 0.5).ok).toBe(true);
    expect(brightnessCheck(0.5, 0.5, 0.5).ok).toBe(false);
    expect(brightnessCheck(0.5, 1, 1).ok).toBe(false);
  });
  it('A7 on the iOS simulator (fixed 0.5) is SKIPPED, never a pass; elsewhere 0.5 throughout fails', () => {
    expect(brightnessCheck(0.5, 0.5, 0.5, true)).toMatchObject({ ok: false, skipped: true });
    expect(brightnessCheck(0.5, 0.5, 0.5, false)).toMatchObject({ ok: false });
    expect(brightnessCheck(0.5, 0.5, 0.5, false).skipped).toBeUndefined();
    expect(brightnessCheck(0.3, 1, 0.3, true).ok).toBe(true);
  });
  it('summary counts only checks that ran', () => {
    const ok = { name: 'a', ok: true, detail: '' };
    expect(summary([ok, { ...ok, ok: false, skipped: true }])).toBe('SELFTEST PASS 1/1 (1 skipped)');
    expect(summary([ok, { ...ok, ok: false }])).toBe('SELFTEST FAIL 1/2');
    expect(summary([])).toBe('SELFTEST FAIL 0/0');
    expect(summary([ok, { ...ok, ok: false, reportOnly: true }])).toBe('SELFTEST PASS 1/1 (report-only 0/1)');
  });
  it('R10 text checks all pass in Node', () => {
    expect(textChecks().filter((c) => !c.ok)).toEqual([]);
  });
  it('A3 rows = 13 formats at their maximum + 8 hard rows; one row times in Node', () => {
    expect(A3_ROWS).toHaveLength(21);
    let t = 0;
    const row = timeRow('ean13', '4006381333931', 'max 13', () => (t += 1));
    expect(row.modules).toMatch(/^\d+x\d+$/);
    expect(row.ms).toBe(1); // each now() call advances the fake clock by 1
  });
});

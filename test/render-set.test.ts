/**
 * @jest-environment node
 */
import { expectedDecode, formatReport, loadEntries, normaliseDecoded, prepare, score, tally, type Decoded } from './render-set';

describe('render-set scoring (SPEC §13)', () => {
  it('loads only documented keys, maps loose format names, keeps expectDecoded null for rejection cases', () => {
    const { entries, rejected } = loadEntries([{ format: 'EAN_13', value: '4006381333931' }, { format: 'codabar', value: 'A1B', expectDecoded: '1', note: 'x' }, { format: 'maxicode', value: 'q' }, { format: 'ean13', value: 7 }, 'junk', { format: 'ean13', value: '4006381333930', expectDecoded: null }], 'b1.json');
    expect(entries.map((e) => [e.format, e.value, e.expectDecoded])).toEqual([
      ['ean13', '4006381333931', undefined],
      ['codabar', 'A1B', '1'],
      ['ean13', '4006381333930', null],
    ]);
    expect(rejected).toHaveLength(3);
  });

  it('conventions: UPC-A as EAN-13 with a leading 0, Codabar without start/stop, ITF unchanged', () => {
    expect(expectedDecode('upca', '036000291452')).toBe('0036000291452');
    expect(expectedDecode('codabar', 'A123B')).toBe('123');
    expect(expectedDecode('codabar', '123')).toBe('123');
    expect(expectedDecode('itf', '1234')).toBe('1234');
    expect(normaliseDecoded('codabar', 'C123D', 'VNBarcodeSymbologyCodabar')).toBe('123');
    expect(normaliseDecoded('upca', '036000291452', 'VNBarcodeSymbologyUPCE')).toBe('0036000291452');
    expect(normaliseDecoded('ean13', '4006381333931', 'VNBarcodeSymbologyEAN13')).toBe('4006381333931');
  });

  it('scores ok / not decoded / wrong value / rejected and tallies per format × scale × contrast', () => {
    const prepared = prepare([
      { format: 'ean13', value: '4006381333931' },
      { format: 'ean13', value: '4006381333930' }, // bad check → rejected by validate
      { format: 'qr', value: 'hi' },
    ]);
    expect(prepared[1].rejected).toBe('checkDigit');
    const decoded: Decoded = new Map();
    decoded.set('out/3px-bw/0000-ean13.png', [{ value: '4006381333931', symbology: 'VNBarcodeSymbologyEAN13' }]);
    decoded.set('out/3px-dim/0000-ean13.png', [{ value: '4006381333937', symbology: 'VNBarcodeSymbologyEAN13' }]);
    decoded.set('out/2px-bw/0002-qr.png', [{ value: 'hi', symbology: 'VNBarcodeSymbologyQR' }]);
    const results = score(prepared, decoded, 'out');
    const at = (i: number, s: number, c: string) => results.find((r) => r.entry === prepared[i].entry && r.scale === s && r.contrast === c)!.outcome;
    expect(at(0, 3, 'bw')).toBe('ok');
    expect(at(0, 3, 'dim')).toBe('wrongValue');
    expect(at(0, 2, 'bw')).toBe('notDecoded');
    expect(at(1, 3, 'bw')).toBe('rejected');
    // R1: a null expectation means "the engine must refuse": rejection = ok, acceptance = wrong value
    const nullSet = prepare([{ format: 'ean13', value: '4006381333930', expectDecoded: null }, { format: 'ean13', value: '4006381333931', expectDecoded: null }]);
    const nullDecoded: Decoded = new Map([['out/3px-bw/0001-ean13.png', [{ value: '4006381333931', symbology: 'VNBarcodeSymbologyEAN13' }]]]);
    const nullResults = score(nullSet, nullDecoded, 'out');
    expect(nullResults.find((r) => r.entry === nullSet[0].entry && r.scale === 3 && r.contrast === 'bw')!.outcome).toBe('ok');
    expect(nullResults.find((r) => r.entry === nullSet[1].entry && r.scale === 3 && r.contrast === 'bw')!.outcome).toBe('wrongValue');
    expect(nullResults.find((r) => r.entry === nullSet[1].entry && r.scale === 2 && r.contrast === 'bw')!.got).toBe('(accepted an invalid value)');
    expect(at(2, 2, 'bw')).toBe('ok');
    const t = tally(results);
    expect(t.get('ean13|3|bw')).toEqual({ n: 2, ok: 1, notDecoded: 0, wrongValue: 0, rejected: 1, renderError: 0 });
    expect(t.get('all|*|*')!.n).toBe(18);
    const report = formatReport('t', results, { misses: true, evidence: true });
    expect(report).toContain('BLIND SET');
    expect(report).toContain('wrong values total 1');
    expect(report).toContain('ean13');
  });
});

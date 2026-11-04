/**
 * @jest-environment node
 */
import { codeKey } from '@/db/code-cache';
import { expandRows, renderMatrix } from '@/engine/barcode/render';
import { toSvg } from '@/engine/barcode/svg';

import { buildCodeCache, pathRows } from './code-cache';

const CASES = [
  ['qr', 'CARD-123456789012'],
  ['qr', 'Müller ☃ 日本'],
  ['aztec', 'AZ1234567890'],
  ['pdf417', 'PDF1234567890'],
  ['datamatrix', 'DM1234567890'],
  ['datamatrix', 'ü'.repeat(40)],
] as const;

describe('render-once cache (D42)', () => {
  it.each(CASES)('%s %s: the path paints exactly the engine rows toSvg draws', (format, value) => {
    const entry = buildCodeCache(value, format);
    expect(entry).not.toBeNull();
    const m = renderMatrix(value, format);
    const rows = expandRows(m);
    expect(entry!.modulesWide).toBe(m.modulesWide);
    expect(entry!.modulesHigh).toBe(rows.length);
    expect(pathRows(entry!.path, entry!.modulesWide, entry!.modulesHigh)).toEqual(rows);
    // same symbol size as the engine's SVG at 1 px per module
    const svg = toSvg(m, { modulePx: 1 });
    expect([svg.widthPx, svg.heightPx]).toEqual([entry!.modulesWide, entry!.modulesHigh]);
    expect(entry!.key).toBe(codeKey(format, value));
  });

  it('1D, number-only and undrawable values have no entry', () => {
    expect(buildCodeCache('4006381333931', 'ean13')).toBeNull();
    expect(buildCodeCache('123', 'none')).toBeNull();
    expect(buildCodeCache('', 'qr')).toBeNull();
    expect(buildCodeCache('x'.repeat(1001), 'qr')).toBeNull();
  });
});

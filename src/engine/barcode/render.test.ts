/**
 * @jest-environment node
 */
import { FORMAT_IDS, FORMATS } from './formats';
import { layout, MIN_BAR_HEIGHT_PX } from './layout';
import { toPng } from './png';
import { encoderText, expandRows, renderMatrix, symbolSize } from './render';
import { toSvg } from './svg';

const SAMPLE: Record<string, string> = {
  ean13: '4006381333931',
  ean8: '96385074',
  upca: '036000291452',
  upce: '01234565',
  code128: 'HELLO 123',
  code39: 'ABC-123',
  code93: 'ABC-123',
  itf: '1234567890',
  codabar: 'A12345B',
  qr: 'Müller ☃',
  aztec: 'hello',
  pdf417: 'hello',
  datamatrix: 'hello',
};

describe('renderMatrix', () => {
  it('renders every format with the quiet zones of D20 and the right symbol widths', () => {
    for (const id of FORMAT_IDS) {
      if (id === 'none') continue;
      const m = renderMatrix(SAMPLE[id], id);
      expect(m.format).toBe(id);
      expect(m.quiet.left).toBe(FORMATS[id].quietLeft);
      expect(m.rows.every((r) => r.length === m.modulesWide)).toBe(true);
      expect(m.rowHeights.reduce((a, b) => a + b, 0)).toBe(m.modulesHigh);
    }
    expect(symbolSize(renderMatrix('4006381333931', 'ean13'))).toEqual({ wide: 95, high: 35 });
    expect(symbolSize(renderMatrix('96385074', 'ean8')).wide).toBe(67);
    expect(symbolSize(renderMatrix('01234565', 'upce')).wide).toBe(51);
    expect(symbolSize(renderMatrix('hello', 'qr'))).toEqual({ wide: 21, high: 21 });
  });
  it('EAN guard bars are extended and nothing else', () => {
    const m = renderMatrix('4006381333931', 'ean13');
    expect(m.rows).toHaveLength(2);
    const ext = m.rows[1].slice(m.quiet.left, -m.quiet.right);
    expect(ext.slice(0, 3)).toBe('101');
    expect(ext.slice(45, 50)).toBe('01010');
    expect(ext.slice(92, 95)).toBe('101');
    expect([...ext].filter((c) => c === '1')).toHaveLength(6); // 2 + 2 + 2 guard bars
  });
  it('1D rows start with a bar and end with a bar (the sbs convention)', () => {
    for (const id of ['code128', 'code39', 'itf', 'codabar', 'code93'] as const) {
      const m = renderMatrix(SAMPLE[id], id);
      const body = m.rows[0].slice(m.quiet.left, m.modulesWide - m.quiet.right);
      expect(body[0] + body[body.length - 1]).toBe('11');
    }
  });
  it('PDF417 rows are 3 modules tall; QR rows 1', () => {
    const p = renderMatrix('hello', 'pdf417');
    expect(p.rowHeights[1]).toBe(3);
    expect(expandRows(p)).toHaveLength(p.modulesHigh);
    expect(renderMatrix('hello', 'qr').rowHeights[1]).toBe(1);
  });
  it('Codabar without start/stop letters is wrapped in A…B for the encoder only', () => {
    expect(encoderText('12345', 'codabar')).toBe('A12345B');
    expect(encoderText('C12345D', 'codabar')).toBe('C12345D');
    expect(renderMatrix('12345', 'codabar').rows[0]).toBe(renderMatrix('A12345B', 'codabar').rows[0]);
  });
  it('rejects a value the encoder cannot take', () => {
    expect(() => renderMatrix('ABC', 'ean13')).toThrow();
    expect(() => renderMatrix('x', 'none')).toThrow('no barcode');
  });
});

describe('svg / png', () => {
  it('SVG uses integer rects at the module scale, no text, crisp edges', () => {
    const m = renderMatrix('96385074', 'ean8');
    const { svg, widthPx, heightPx } = toSvg(m, { modulePx: 3, barHeightPx: 90 });
    expect(widthPx).toBe(m.modulesWide * 3);
    expect(heightPx).toBe(90);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).not.toContain('<text');
    expect(svg.match(/<rect /g)!.length).toBeGreaterThan(20);
    for (const [, x, w] of svg.matchAll(/<rect x="(\d+)" y="\d+" width="(\d+)"/g)) expect([Number(x) % 3, Number(w) % 3]).toEqual([0, 0]);
  });
  it('PNG has the right size and a valid signature/IHDR', () => {
    const m = renderMatrix('hello', 'qr');
    const { png, widthPx, heightPx } = toPng(m, { modulePx: 4 });
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(widthPx);
    expect(view.getUint32(20)).toBe(heightPx);
    expect(widthPx).toBe(m.modulesWide * 4);
    expect(heightPx).toBe(m.modulesHigh * 4);
  });
});

/** Seeded PRNG for the property tests (mulberry32). */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('layout (property tests, seeded viewports)', () => {
  it('always integer modules; the symbol fits the viewport when it can; rotation only helps 1D', () => {
    const rand = prng(42);
    const matrices = [renderMatrix('4006381333931', 'ean13'), renderMatrix('x'.repeat(60), 'code128'), renderMatrix('hello', 'qr'), renderMatrix('x'.repeat(400), 'pdf417')];
    for (let i = 0; i < 2000; i++) {
      const m = matrices[i % matrices.length];
      const vp = { widthPx: 200 + Math.floor(rand() * 1200), heightPx: 200 + Math.floor(rand() * 1200) };
      const ratio = [1, 2, 3][Math.floor(rand() * 3)];
      const l = layout(m, vp, FORMATS[m.format].minModulePx, ratio);
      expect(Number.isInteger(l.modulePx) && l.modulePx >= 1).toBe(true);
      expect(l.widthPx).toBe(m.modulesWide * l.modulePx);
      const alongBars = l.rotate ? vp.heightPx * ratio : vp.widthPx * ratio;
      if (l.widthPx > Math.floor(alongBars)) expect(l.modulePx).toBe(1); // only when even 1 px does not fit
      if (m.kind === '2d') {
        expect(l.rotate).toBe(false);
        expect(l.heightPx).toBe(m.modulesHigh * l.modulePx);
      } else {
        expect(l.heightPx).toBeGreaterThanOrEqual(Math.min(MIN_BAR_HEIGHT_PX, l.rotate ? vp.widthPx * ratio : vp.heightPx * ratio));
        expect(l.heightPx).toBeGreaterThanOrEqual(Math.min(Math.floor(l.widthPx / 4), l.rotate ? vp.widthPx * ratio : vp.heightPx * ratio));
      }
      expect(l.dense).toBe(l.modulePx < FORMATS[m.format].minModulePx);
      // a wider viewport never turns a readable code into a dense one (it may stop rotating and pick a smaller, still readable scale)
      const l2 = layout(m, { widthPx: vp.widthPx + 100, heightPx: vp.heightPx + 100 }, FORMATS[m.format].minModulePx, ratio);
      if (!l.dense) expect(l2.dense).toBe(false);
      if (l.rotate === l2.rotate) expect(l2.modulePx).toBeGreaterThanOrEqual(l.modulePx);
    }
  });
  it('rotates a long Code 128 on a narrow portrait screen and reports density honestly', () => {
    const m = renderMatrix('x'.repeat(60), 'code128');
    const l = layout(m, { widthPx: 390, heightPx: 844 }, 3, 3);
    expect(l.rotate).toBe(true);
    expect(l.modulePx).toBe(Math.floor((844 * 3) / m.modulesWide));
    const tiny = layout(m, { widthPx: 300, heightPx: 400 }, 3, 1);
    expect(tiny.dense).toBe(true);
  });
});

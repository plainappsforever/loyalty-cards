// PNG from a module matrix (widgets, self-test fixtures): 8-bit greyscale, zlib via fflate (MIT), no dependency on
// bwip-js's PNG path (its react-native build needs react-zlib-js). Integer scaling, two colours, no anti-aliasing.
import { zlibSync } from 'fflate';

import type { FormatId } from './formats';
import { expandRows, renderMatrix, type Matrix } from './render';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export type PngOptions = { modulePx: number; barHeightPx?: number; fg?: number; bg?: number };

/** Greyscale PNG bytes of the matrix at `modulePx` pixels per module (fg/bg = 0…255 grey levels; default black on white). */
export function toPng(m: Matrix, opts: PngOptions): { png: Uint8Array; widthPx: number; heightPx: number } {
  const s = Math.max(1, Math.floor(opts.modulePx));
  const fg = opts.fg ?? 0;
  const bg = opts.bg ?? 255;
  const rows = expandRows(m, m.kind === '1d' && opts.barHeightPx ? Math.ceil(opts.barHeightPx / s) : undefined);
  const widthPx = m.modulesWide * s;
  const heightPx = rows.length * s;
  const rawLine = widthPx + 1;
  const raw = new Uint8Array(rawLine * heightPx);
  rows.forEach((row, ry) => {
    const line = new Uint8Array(widthPx);
    for (let x = 0; x < row.length; x++) line.fill(row[x] === '1' ? fg : bg, x * s, (x + 1) * s);
    for (let k = 0; k < s; k++) {
      const off = (ry * s + k) * rawLine;
      raw[off] = 0; // filter: none
      raw.set(line, off + 1);
    }
  });
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, widthPx);
  v.setUint32(4, heightPx);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [signature, chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    png.set(p, off);
    off += p.length;
  }
  return { png, widthPx, heightPx };
}

/** SPEC §5.2 `renderPng(value, format, scale)` for widgets: PNG bytes at `scale` px per module. */
export function renderPng(value: string, format: FormatId, scale: number, barHeightPx?: number): { png: Uint8Array; widthPx: number; heightPx: number; modulesWide: number; modulesHigh: number } {
  const matrix = renderMatrix(value, format);
  return { ...toPng(matrix, { modulePx: scale, barHeightPx }), modulesWide: matrix.modulesWide, modulesHigh: matrix.modulesHigh };
}

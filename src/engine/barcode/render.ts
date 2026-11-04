// Rendering (SPEC §5.2, D12): bwip-js (MIT; BWIPP by Terry Burton, see DECISIONS D28) computes the module matrix through
// its pure `generic` entry (`raw`: bar/space widths for 1D, a pixel grid for 2D); THIS file turns the matrix into one
// `Matrix` with quiet zones, and svg.ts / png.ts draw it with integer module scaling and no text (the UI shows the
// number as selectable text next to the code, L26). The referee rasteriser (referee/swift/rasterize.swift) draws the
// same `Matrix`, so what Vision reads in the blind runs is what the phone draws.
import { encodeRaw, type Raw1D, type Raw2D } from './encode';
import { FORMATS, type FormatId } from './formats';
import { validate, type ValidationError } from './validate';

export { encoderOptions, encoderText } from './encode';

/** One rendered code at module resolution, quiet zones included. Rows are top-first; '1' = dark. */
export type Matrix = {
  format: FormatId;
  kind: '1d' | '2d';
  /** Width/height in modules including the quiet zones. */
  modulesWide: number;
  modulesHigh: number;
  /** Quiet zone in modules (left/right; top/bottom for 2D). */
  quiet: { left: number; right: number; top: number; bottom: number };
  /** Module rows as strings of '0'/'1' (2D: every row; 1D: one row per distinct bar height, see `rowHeights`). */
  rows: string[];
  /** Height in modules of each entry in `rows` (1D: bar height and the guard extension; 2D: 1, PDF417 rows 3). */
  rowHeights: number[];
};

/** Guard-bar module positions of the EAN/UPC symbols (drawn 5 modules longer, the printed convention). */
const GUARDS: Partial<Record<FormatId, [number, number][]>> = {
  ean13: [
    [0, 3],
    [45, 50],
    [92, 95],
  ],
  upca: [
    [0, 3],
    [45, 50],
    [92, 95],
  ],
  ean8: [
    [0, 3],
    [31, 36],
    [64, 67],
  ],
  upce: [
    [0, 3],
    [45, 51],
  ],
};
const GUARD_EXTRA = 5;
/** 1D bar height in modules before layout (layout.ts stretches to ≥ 25 % of the width / ≥ 64 px). */
export const BAR_HEIGHT_MODULES = 30;

export class RenderRefusedError extends Error {
  readonly format: FormatId;
  readonly error: ValidationError;
  readonly suggestion?: string;
  // plain fields, no parameter properties: the Node script loader (type stripping) cannot run those
  constructor(format: FormatId, error: ValidationError, suggestion?: string) {
    super(`cannot draw ${format}: ${error}`);
    this.format = format;
    this.error = error;
    this.suggestion = suggestion;
  }
}

/**
 * Renders the value's module matrix. The ONE choke point (review M1): the value goes through `validate()` first and a
 * value it rejects is refused with RenderRefusedError — never completed, padded or re-encoded by the encoder. The
 * canonical value (separators removed, Code 39/93/Codabar upper case) is what is drawn.
 */
export function renderMatrix(value: string, format: FormatId): Matrix {
  if (!FORMATS[format].bwip) throw new Error(`format ${format} has no barcode`);
  const v = validate(value, format);
  if (!v.ok) throw new RenderRefusedError(format, v.error, v.suggestion?.value);
  const raw = encodeRaw(v.value, format);
  if ('sbs' in raw) return from1D(format, raw);
  return from2D(format, raw);
}

function from1D(format: FormatId, raw: Raw1D): Matrix {
  const info = FORMATS[format];
  // sbs alternates bar, space, bar … (index 0 = bar); some encoders (Code 39, Codabar, ITF) end on an inter-character
  // gap, which is dropped so the symbol ends on a bar and the quiet zone is exactly the format's.
  const sbs = raw.sbs.length % 2 === 0 ? raw.sbs.slice(0, -1) : raw.sbs;
  const width = sbs.reduce((a, b) => a + b, 0);
  const cells = new Array<string>(width).fill('0');
  let x = 0;
  sbs.forEach((w, i) => {
    if (i % 2 === 0) for (let k = 0; k < w; k++) cells[x + k] = '1';
    x += w;
  });
  const quiet = { left: info.quietLeft, right: info.quietRight, top: 0, bottom: 0 };
  const pad = (row: string[]) => '0'.repeat(quiet.left) + row.join('') + '0'.repeat(quiet.right);
  const body = pad(cells);
  const guards = GUARDS[format];
  if (!guards) return { format, kind: '1d', modulesWide: width + quiet.left + quiet.right, modulesHigh: BAR_HEIGHT_MODULES, quiet, rows: [body], rowHeights: [BAR_HEIGHT_MODULES] };
  const ext = cells.map((c, i) => (c === '1' && guards.some(([a, b]) => i >= a && i < b) ? '1' : '0'));
  return { format, kind: '1d', modulesWide: width + quiet.left + quiet.right, modulesHigh: BAR_HEIGHT_MODULES + GUARD_EXTRA, quiet, rows: [body, pad(ext)], rowHeights: [BAR_HEIGHT_MODULES, GUARD_EXTRA] };
}

function from2D(format: FormatId, raw: Raw2D): Matrix {
  const info = FORMATS[format];
  const w = raw.pixx;
  const rows = raw.pixs.length / w;
  const rowHeight = Math.max(1, Math.round(raw.pixy / rows)); // PDF417: 3 (bwipp rowmult)
  const q = info.quietLeft;
  const quiet = { left: q, right: q, top: q, bottom: q };
  const out: string[] = [];
  const heights: number[] = [];
  const blank = '0'.repeat(w + 2 * q);
  out.push(blank);
  heights.push(q);
  for (let y = 0; y < rows; y++) {
    let s = '0'.repeat(q);
    for (let x = 0; x < w; x++) s += raw.pixs[y * w + x] ? '1' : '0';
    out.push(s + '0'.repeat(q));
    heights.push(rowHeight);
  }
  out.push(blank);
  heights.push(q);
  return { format, kind: '2d', modulesWide: w + 2 * q, modulesHigh: rows * rowHeight + 2 * q, quiet, rows: out, rowHeights: heights };
}

/** Expands the matrix to one string row per module row (what the rasterisers draw). 1D rows are stretched to `barHeight` modules. */
export function expandRows(m: Matrix, barHeight = m.modulesHigh): string[] {
  const out: string[] = [];
  if (m.kind === '2d') {
    m.rows.forEach((row, i) => {
      for (let k = 0; k < m.rowHeights[i]; k++) out.push(row);
    });
    return out;
  }
  const extra = m.rows.length > 1 ? m.rowHeights[1] : 0;
  const main = Math.max(1, barHeight - extra);
  for (let k = 0; k < main; k++) out.push(m.rows[0]);
  for (let k = 0; k < extra; k++) out.push(m.rows[1]);
  return out;
}

/** Module counts without quiet zones (for the UI's density warning and tests). */
export function symbolSize(m: Matrix): { wide: number; high: number } {
  return { wide: m.modulesWide - m.quiet.left - m.quiet.right, high: m.modulesHigh - m.quiet.top - m.quiet.bottom };
}

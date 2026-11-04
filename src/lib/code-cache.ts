// Render-once for 2D codes (D41.1, D42). On Hermes a heavy Aztec/QR encode takes up to ~1 s (S4), so the card screen
// must never encode: saving, importing or seeding a card builds this entry once and stores it with the row. The entry is
// the engine's own module matrix (renderMatrix: validate first, refuse what it refuses), serialised as SVG path data in
// module units — exactly the rows `toSvg` draws for 2D (expandRows, one module per unit), so scaling the path by the
// layout's integer module size gives the same picture as `toSvg(matrix, { modulePx })`.
import { codeKey, type CodeCacheEntry } from '@/db/code-cache';
import { FORMATS, type FormatId } from '@/engine/barcode/formats';
import { expandRows, renderMatrix, type Matrix } from '@/engine/barcode/render';

export const isTwoD = (format: FormatId): boolean => FORMATS[format].kind === '2d';

/**
 * One subpath per rectangle of dark modules: a horizontal run, extended downwards while the next rows have exactly the
 * same run (`M x y h w v h h -w z`). Fewer subpaths than one per run per row: QR/Aztec/Data Matrix finder and timing
 * patterns and PDF417's 3-row modules merge, which shortens the path native code parses on every card open.
 */
export function matrixPath(m: Matrix): string {
  const rows = expandRows(m);
  const runsOf = (row: string): [number, number][] => {
    const out: [number, number][] = [];
    let x = 0;
    while (x < row.length) {
      if (row[x] === '1') {
        let end = x;
        while (end < row.length && row[end] === '1') end++;
        out.push([x, end - x]);
        x = end;
      } else x++;
    }
    return out;
  };
  // open rectangles keyed by "x,w" → top row
  let open = new Map<string, number>();
  const parts: string[] = [];
  const close = (key: string, top: number, bottom: number) => {
    const [x, w] = key.split(',').map(Number);
    parts.push(`M${x} ${top}h${w}v${bottom - top}h-${w}z`);
  };
  rows.forEach((row, y) => {
    const next = new Map<string, number>();
    for (const [x, w] of runsOf(row)) {
      const key = `${x},${w}`;
      next.set(key, open.get(key) ?? y);
    }
    for (const [key, top] of open) if (!next.has(key)) close(key, top, y);
    open = next;
  });
  for (const [key, top] of open) close(key, top, rows.length);
  return parts.join('');
}

/** Rows of '0'/'1' painted by a path from `matrixPath` (test helper and self-check). */
export function pathRows(path: string, wide: number, high: number): string[] {
  const grid = Array.from({ length: high }, () => Array<string>(wide).fill('0'));
  for (const m of path.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-\d+z/g)) {
    const [x, y, w, h] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    for (let r = y; r < y + h; r++) for (let i = x; i < x + w; i++) grid[r][i] = '1';
  }
  return grid.map((r) => r.join(''));
}

/**
 * The cache entry for a card's code, or null when the format is not 2D (1D renders live) or the value cannot be drawn
 * (the card screen then shows the number and the reason, as it does without a cache).
 */
export function buildCodeCache(value: string, format: FormatId): CodeCacheEntry | null {
  if (!isTwoD(format) || value === '') return null;
  let m: Matrix;
  try {
    m = renderMatrix(value, format);
  } catch {
    return null;
  }
  const rows = expandRows(m);
  return { key: codeKey(format, value), modulesWide: m.modulesWide, modulesHigh: rows.length, path: matrixPath(m) };
}

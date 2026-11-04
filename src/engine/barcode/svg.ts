// SVG for react-native-svg (`SvgXml`): pure black bars on white, integer module scale, no anti-aliasing hints, no text.
import type { FormatId } from './formats';
import { expandRows, renderMatrix, type Matrix } from './render';

export type SvgOptions = { modulePx: number; barHeightPx?: number; fg?: string; bg?: string };

/** One <rect> per run of dark modules per row (merged vertically for 1D), width/height in pixels. */
export function toSvg(m: Matrix, opts: SvgOptions): { svg: string; widthPx: number; heightPx: number } {
  const s = Math.max(1, Math.floor(opts.modulePx));
  const fg = opts.fg ?? '#000000';
  const bg = opts.bg ?? '#ffffff';
  const widthPx = m.modulesWide * s;
  const rows = m.kind === '1d' ? m.rows : expandRows(m);
  const heights = m.kind === '1d' ? rowHeights1D(m, opts.barHeightPx, s) : rows.map(() => s);
  const heightPx = heights.reduce((a, b) => a + b, 0);
  const rects: string[] = [];
  let y = 0;
  rows.forEach((row, i) => {
    const h = heights[i];
    let x = 0;
    while (x < row.length) {
      if (row[x] === '1') {
        let end = x;
        while (end < row.length && row[end] === '1') end++;
        rects.push(`<rect x="${x * s}" y="${y}" width="${(end - x) * s}" height="${h}"/>`);
        x = end;
      } else x++;
    }
    y += h;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}" shape-rendering="crispEdges"><rect width="${widthPx}" height="${heightPx}" fill="${bg}"/><g fill="${fg}">${rects.join('')}</g></svg>`;
  return { svg, widthPx, heightPx };
}

/** 1D: the main row takes the bar height, the guard row its 5 modules. */
function rowHeights1D(m: Matrix, barHeightPx: number | undefined, s: number): number[] {
  const extra = m.rows.length > 1 ? m.rowHeights[1] * s : 0;
  const total = Math.max(barHeightPx ?? m.modulesHigh * s, extra + s);
  return m.rows.length > 1 ? [total - extra, extra] : [total];
}

/** SPEC §5.2 `renderSvg(value, format)`: matrix + SVG in one call (the UI passes the layout's module size). */
export function renderSvg(value: string, format: FormatId, opts: SvgOptions): { svg: string; widthPx: number; heightPx: number; modulesWide: number; modulesHigh: number; matrix: Matrix } {
  const matrix = renderMatrix(value, format);
  return { ...toSvg(matrix, opts), modulesWide: matrix.modulesWide, modulesHigh: matrix.modulesHigh, matrix };
}

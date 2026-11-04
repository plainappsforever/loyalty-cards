// Layout (SPEC §5.2, D20): the integer module scale for a viewport so that every module is ≥ minModulePx device pixels
// and the whole symbol (quiet zones included) fits; a 1D code too wide for the portrait width is rotated into the
// height (always, D45.4); when even
// that is too dense the code is still drawn at the minimum and flagged `dense` (the UI warns, L26). Deterministic,
// integer-only; property-tested with seeded viewports.
import type { Matrix } from './render';

export type Viewport = { widthPx: number; heightPx: number };
export type Layout = {
  /** Device pixels per module (integer, ≥ 1). */
  modulePx: number;
  rotate: boolean;
  /** Drawn size in device pixels before rotation (width along the bars' axis). */
  widthPx: number;
  heightPx: number;
  /** True when modulePx < the format's minimum: the code may be too dense for scanners. */
  dense: boolean;
};

export const MIN_BAR_HEIGHT_PX = 64;
/**
 * Bars at least this many MODULES tall (D34, B1 N1): Vision decodes every short 1D code (UPC-E, EAN-8, Code 39, Codabar,
 * EAN-13, UPC-A, ITF) at 2/3/4 px × both contrasts from 24 module rows (P4c measurement, 10,626 PNGs); 32 leaves a
 * margin. The old rule max(25 % of width, 64 px) gave a 67-module UPC-E at 4 px only ~17 rows.
 */
export const MIN_BAR_MODULES = 32;

/** Largest integer scale so the symbol fits `available` pixels; 0 when even 1 px per module does not fit. */
function fit(modules: number, available: number): number {
  return Math.floor(available / modules);
}

/**
 * `minModulePx` comes from the format (3 for 1D, 4 for 2D); `pixelRatio` turns points into device pixels (the result is
 * in device pixels; the caller divides by the ratio for the view size).
 */
export function layout(m: Pick<Matrix, 'kind' | 'modulesWide' | 'modulesHigh'>, viewport: Viewport, minModulePx: number, pixelRatio = 1): Layout {
  const vw = Math.max(1, Math.floor(viewport.widthPx * pixelRatio));
  const vh = Math.max(1, Math.floor(viewport.heightPx * pixelRatio));
  const minPx = Math.max(1, Math.floor(minModulePx)); // device pixels (D20), independent of the ratio
  if (m.kind === '2d') {
    const s = Math.min(fit(m.modulesWide, vw), fit(m.modulesHigh, vh));
    const modulePx = Math.max(1, s);
    return { modulePx, rotate: false, widthPx: m.modulesWide * modulePx, heightPx: m.modulesHigh * modulePx, dense: modulePx < minPx };
  }
  // 1D: portrait width first; when the minimum module does not fit there, ALWAYS rotated 90° and recomputed for the
  // height (SPEC §5.2 literal, D45.4) — even when the height is the smaller room; `dense` then says so honestly
  const portrait = fit(m.modulesWide, vw);
  const rotate = portrait < minPx;
  const s = rotate ? fit(m.modulesWide, vh) : portrait;
  const modulePx = Math.max(1, s);
  const widthPx = m.modulesWide * modulePx;
  const across = rotate ? vw : vh; // room for the bar height
  // 25 % of the width ROUNDED UP: the SPEC's max(25 % of width, …) is a lower bound, and a floor fell one pixel short (B2 LY-04)
  const heightPx = Math.min(Math.max(Math.ceil(widthPx / 4), MIN_BAR_HEIGHT_PX, MIN_BAR_MODULES * modulePx), Math.max(1, across));
  return { modulePx, rotate, widthPx, heightPx, dense: modulePx < minPx };
}

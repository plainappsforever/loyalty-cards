// Barcode PNGs for the widgets (SPEC §5.2 renderPng, §6.4). The module size comes from `widgetPngPlan` (layout() for the
// widget's code box, src/lib/widget-data.ts). 1D codes are encoded live (≤ 1.3 ms on Hermes, S4); 2D codes are NEVER
// encoded here: their module grid comes from the render-once cache (D42), the same rows the card screen draws, so a
// heavy Aztec costs no second encode. Pure (engine PNG writer, no React Native), tested in Node.
import type { CodeCacheEntry } from '@/db/code-cache';
import { FORMATS, type FormatId } from '@/engine/barcode/formats';
import { toPng } from '@/engine/barcode/png';
import { renderMatrix, type Matrix } from '@/engine/barcode/render';

import { pathRows } from './code-cache';
import { widgetPngPlan, type Box } from './widget-data';

export type WidgetPng = { png: Uint8Array; widthPx: number; heightPx: number; modulePx: number };

/** A 2D module matrix rebuilt from a cache entry (quiet zone included in the rows, as stored). */
export function matrixFromCache(format: FormatId, entry: CodeCacheEntry): Matrix {
  const rows = pathRows(entry.path, entry.modulesWide, entry.modulesHigh);
  return {
    format,
    kind: '2d',
    modulesWide: entry.modulesWide,
    modulesHigh: entry.modulesHigh,
    quiet: { left: 0, right: 0, top: 0, bottom: 0 },
    rows,
    rowHeights: rows.map(() => 1),
  };
}

/**
 * The widget PNG for a card's code, or null: no barcode format, a 2D code without a current cache entry, a value the
 * engine refuses, or a code `layout()` would rotate / flag dense in this box.
 */
export function widgetPng(code: string, format: FormatId, cache: CodeCacheEntry | null, box: Box, pixelRatio: number): WidgetPng | null {
  const info = FORMATS[format];
  if (info.kind === 'none' || code === '') return null;
  let matrix: Matrix;
  if (info.kind === '2d') {
    if (!cache) return null;
    matrix = matrixFromCache(format, cache);
  } else {
    try {
      matrix = renderMatrix(code, format);
    } catch {
      return null;
    }
  }
  const plan = widgetPngPlan(matrix, info.minModulePx, box, pixelRatio);
  if (!plan) return null;
  const out = toPng(matrix, { modulePx: plan.modulePx, barHeightPx: plan.barHeightPx });
  return { ...out, modulePx: plan.modulePx };
}

// What the widgets and app shortcuts show (SPEC §5.8, §6.4, A10, A11). Pure: the device glue (src/lib/widgets.ts)
// reads the cards, writes the barcode PNGs and pushes the result to the iOS widget extension / Android RemoteViews.
//
// Barcode PNG scale (P7 rule): the module size comes from the engine's `layout()` for the widget's code box at the
// screen's pixel ratio — the same integer-module rule the card screen uses (D20), so a widget code is never a scaled
// bitmap: one PNG pixel = one device pixel, every module a whole number of pixels. When `layout()` says the code would
// have to be rotated (a long 1D code) or would be too dense (`dense`), the widget shows NO barcode, only the tile and
// "Open" (L26: a widget must not show a code that no scanner reads; the card screen can rotate, a widget cannot).
import { FORMATS, type FormatId } from '@/engine/barcode/formats';
import { layout } from '@/engine/barcode/layout';
import type { Matrix } from '@/engine/barcode/render';
import { groupNumber, textColorOn } from '@/engine/format';
import { mostUsed, type Sortable } from '@/engine/sort';
import { buildSnapshot } from '@/engine/widgets';

/** A code box in points (iOS) / dp (Android). */
export type Box = { width: number; height: number };

/**
 * Code boxes of the widgets that show a barcode, sized for the smallest phone each family appears on (iPhone mini /
 * SE medium widget 329×155 pt minus 16-pt margins; Android 4×2 widget on a 360-dp-wide phone ~ 310×110 dp of content), so the PNG fits
 * every phone and is drawn at its own pixel size (never stretched).
 */
export const WIDGET_CODE_BOX: Record<'ios' | 'android', Record<'1d' | '2d', Box>> = {
  ios: { '1d': { width: 290, height: 62 }, '2d': { width: 112, height: 112 } },
  android: { '1d': { width: 300, height: 70 }, '2d': { width: 104, height: 104 } },
};

export type PngPlan = {
  /** Device pixels per module (integer) — from layout(). */
  modulePx: number;
  /** 1D bar height in device pixels (layout's heightPx); undefined for 2D. */
  barHeightPx: number | undefined;
};

/**
 * The PNG scale for a widget code box, or null when the widget must not show this code (rotation needed or too dense).
 * `minModulePx` = FORMATS[format].minModulePx (3 for 1D, 4 for 2D, D20); `pixelRatio` = PixelRatio.get().
 */
export function widgetPngPlan(m: Pick<Matrix, 'kind' | 'modulesWide' | 'modulesHigh'>, minModulePx: number, box: Box, pixelRatio: number): PngPlan | null {
  const l = layout(m, { widthPx: box.width, heightPx: box.height }, minModulePx, pixelRatio);
  if (l.rotate || l.dense) return null;
  return { modulePx: l.modulePx, barHeightPx: m.kind === '1d' ? l.heightPx : undefined };
}

export type WidgetImage = { uri: string; widthPx: number; heightPx: number };

export type WidgetCard = {
  id: string;
  name: string;
  /** Tile colour and the text colour on it. */
  color: string;
  fg: string;
  initials: string;
  /** Deep link that opens the card (`<scheme>://card/<id>`). */
  url: string;
  /** The printed number, grouped for reading (display only, SPEC §5.7). */
  number: string;
  kind: '1d' | '2d' | 'none';
  /** The barcode PNG and its size in points/dp (pixels ÷ ratio); absent = show the tile and "Open". */
  image?: { uri: string; width: number; height: number };
};

export type WidgetWords = { title: string; open: string; empty: string; noCode: string };

export type WidgetData = {
  title: string;
  open: string;
  empty: string;
  noCode: string;
  /** Opens the app (empty widget). */
  appUrl: string;
  cards: WidgetCard[];
  updatedAt: number;
};

type CardLike = Sortable & { archived: boolean; color: string; format: FormatId; number: string };

/**
 * The widget data: the engine's snapshot order (chosen ids, then favourites in list order, then most used; ≤ 8, never
 * archived) with links, numbers and the images the glue wrote (keyed by card id).
 */
export function buildWidgetData<T extends CardLike>(
  cards: readonly T[],
  widgetCardIds: readonly string[],
  scheme: string,
  words: WidgetWords,
  images: ReadonlyMap<string, WidgetImage>,
  pixelRatio: number,
  now: number
): WidgetData {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const snapshot = buildSnapshot(cards, widgetCardIds, now);
  return {
    ...words,
    appUrl: `${scheme}://`,
    updatedAt: snapshot.updatedAt,
    cards: snapshot.cards.map((s) => {
      const card = byId.get(s.id)!;
      const img = images.get(s.id);
      const kind = FORMATS[card.format].kind;
      return {
        id: s.id,
        name: s.name,
        color: s.color,
        fg: textColorOn(s.color),
        initials: s.initials,
        url: `${scheme}://card/${encodeURIComponent(s.id)}`,
        number: groupNumber(card.number),
        kind,
        ...(img ? { image: { uri: img.uri, width: img.widthPx / pixelRatio, height: img.heightPx / pixelRatio } } : {}),
      };
    }),
  };
}

/** The cards of the snapshot that need a PNG (a barcode format), in snapshot order. */
export function cardsNeedingImages<T extends CardLike>(cards: readonly T[], widgetCardIds: readonly string[], now: number): T[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  return buildSnapshot(cards, widgetCardIds, now)
    .cards.map((s) => byId.get(s.id)!)
    .filter((c) => FORMATS[c.format].kind !== 'none');
}

export const SHORTCUT_COUNT = 4;

export type Shortcut = { id: string; title: string; subtitle: string | null; params: { href: string } };

/**
 * App shortcuts (SPEC §6.4, A11): the 4 most-used live cards (use count, then last used, then manual order — the engine's
 * `mostUsed`); each opens `/card/<id>`. The subtitle is the grouped number (iOS shows it under the name).
 */
export function shortcutItems<T extends CardLike>(cards: readonly T[], count = SHORTCUT_COUNT): Shortcut[] {
  return mostUsed(cards, count).map((c) => ({
    id: `card-${c.id}`,
    title: c.name,
    subtitle: c.number ? groupNumber(c.number) : null,
    params: { href: `/card/${c.id}` },
  }));
}

/** Same list → same key: the glue skips `setItems` when nothing changed. */
export function shortcutsKey(items: readonly Shortcut[]): string {
  return items.map((i) => `${i.id}\u001f${i.title}\u001f${i.subtitle ?? ''}`).join('\u001e');
}

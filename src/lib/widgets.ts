// Pushes what the widgets and app shortcuts show (SPEC §5.8, §6.4, A10, A11). iOS = expo-widgets snapshot
// (src/widgets/cards-widget.tsx, loaded lazily and only in builds that carry the extension) with the barcode PNGs in the
// App Group; Android = the RemoteViews widgets of modules/cards-widget with the PNGs in the app's files folder.
// Shortcuts = expo-quick-actions on iOS, card links from modules/cards-widget on Android (D53). Re-pushed at start, when the app goes to the background (every edit of a
// session is in by then), after a card is opened (debounced 2 s, SPEC §6.4) and when the Cards list gains focus.
// Never throws: a widget that cannot be updated keeps its last picture, and the app goes on.
import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import * as QuickActions from 'expo-quick-actions';
import { AppState, PixelRatio, Platform } from 'react-native';

import { codeOf, listCards, type Card } from '@/db/cards';
import { codeKey, getCodeCache } from '@/db/code-cache';
import { getSettings } from '@/db/settings';
import type { Db } from '@/db/types';
import { FORMATS } from '@/engine/barcode/formats';
import { getLanguage, translate } from '@/i18n';

import CardsWidgetNative from '../../modules/cards-widget';
import { buildWidgetData, cardsNeedingImages, shortcutItems, shortcutsKey, WIDGET_CODE_BOX, type WidgetData, type WidgetImage } from './widget-data';
import { widgetPng } from './widget-png';

type Layouts = typeof import('@/widgets/cards-widget');
let layouts: Layouts | null | undefined;

function iosLayouts(): Layouts | null {
  if (layouts !== undefined) return layouts;
  if (Platform.OS !== 'ios' || Constants.expoConfig?.extra?.widgetsEnabled !== true || !requireOptionalNativeModule('ExpoWidgets')) return (layouts = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    layouts = require('@/widgets/cards-widget') as Layouts;
  } catch (e) {
    console.warn('[widgets] unavailable', e);
    layouts = null;
  }
  return layouts;
}

/** The folder the widget can read: iOS App Group (expo-widgets' shared folder), Android the app's files folder. */
function imageDir(): Directory | null {
  if (Platform.OS === 'ios') {
    if (!iosLayouts()) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const shared = (require('expo-widgets') as typeof import('expo-widgets')).widgetsDirectory;
    return shared ? new Directory(shared) : null;
  }
  return CardsWidgetNative ? new Directory(Paths.document, 'widgets') : null;
}

/** The widget PNG folder (file:// URI) or null; D49 keeps it out of iOS backups. */
export function widgetImageDirUri(): string | null {
  return imageDir()?.uri ?? null;
}

const scheme = () => String(Constants.expoConfig?.scheme ?? 'loyaltycards');

function words() {
  const lang = getLanguage(); // glue, not render
  return {
    title: translate(lang, 'app.name'),
    open: translate(lang, 'widget.open'),
    empty: translate(lang, 'widget.empty'),
    noCode: translate(lang, 'widget.noCode'),
  };
}

const written = new Map<string, { key: string; image: WidgetImage }>();

/** Writes the barcode PNGs of the snapshot cards; returns what was written. Old PNGs of cards no longer shown go. */
async function writeImages(db: Db, cards: readonly Card[], widgetCardIds: readonly string[], dir: Directory, ratio: number, now: number): Promise<Map<string, WidgetImage>> {
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const box = WIDGET_CODE_BOX[Platform.OS === 'ios' ? 'ios' : 'android'];
  const out = new Map<string, WidgetImage>();
  for (const card of cardsNeedingImages(cards, widgetCardIds, now)) {
    const code = codeOf(card);
    const kind = FORMATS[card.format].kind === '2d' ? '2d' : '1d';
    let cache = null;
    if (kind === '2d') {
      // the render-once entry (D42); a missing/stale one means no widget code until the start-up fill has run
      const entry = await getCodeCache(db, card.id);
      cache = entry && entry.key === codeKey(card.format, code) ? entry : null;
    }
    const file = new File(dir, `card-${card.id}.png`);
    // unchanged code, same box and ratio, file still there: keep it (no encode, no write)
    const key = `${card.format}\u001f${code}\u001f${cache?.key ?? ''}\u001f${ratio}\u001f${dir.uri}`;
    const known = written.get(card.id);
    if (known && known.key === key && file.exists) {
      out.set(card.id, known.image);
      continue;
    }
    // yield between cards: the push runs while the user may be tapping (JS thread)
    await new Promise((r) => setTimeout(r, 0));
    const png = widgetPng(code, card.format, cache, box[kind], ratio);
    if (!png) continue;
    if (file.exists) file.delete();
    file.create();
    file.write(png.png);
    const image = { uri: file.uri, widthPx: png.widthPx, heightPx: png.heightPx };
    written.set(card.id, { key, image });
    out.set(card.id, image);
  }
  for (const entry of dir.list()) {
    const m = /^card-(.+)\.png$/.exec(entry.name);
    if (m && !out.has(m[1]) && entry instanceof File) entry.delete();
  }
  return out;
}

let lastShortcuts = '';

async function pushShortcuts(cards: readonly Card[]): Promise<void> {
  const items = shortcutItems(cards);
  const key = shortcutsKey(items);
  if (key === lastShortcuts) return;
  try {
    // D53: Android shortcuts are card links (like a widget tile), so a tap after the system killed the process opens
    // the card; iOS keeps expo-quick-actions (routed by useQuickActionRouting in src/app/index.tsx).
    if (Platform.OS === 'android' && CardsWidgetNative) {
      const links = items.map((i) => ({ id: i.id, title: i.title, url: `${scheme()}:/${i.params.href}` }));
      CardsWidgetNative.setLinkShortcuts(JSON.stringify(links));
    } else {
      await QuickActions.setItems(items);
    }
    lastShortcuts = key;
    console.log(`[shortcuts] ${items.length}: ${items.map((i) => i.title).join(' | ')}`);
  } catch (e) {
    console.warn('[shortcuts] setItems failed', e);
  }
}

/** Build + push once (widgets and shortcuts). Returns the widget data (debug screen, tests on a device). */
export async function pushWidgets(db: Db): Promise<WidgetData | null> {
  const started = performance.now();
  const cards = await listCards(db);
  await pushShortcuts(cards);
  const ios = iosLayouts();
  if (!ios && !CardsWidgetNative) return null;
  const { widgetCardIds } = await getSettings(db);
  const now = Date.now();
  const ratio = PixelRatio.get();
  const dir = imageDir();
  const images = dir ? await writeImages(db, cards, widgetCardIds, dir, ratio, now) : new Map<string, WidgetImage>();
  const data = buildWidgetData(cards, widgetCardIds, scheme(), words(), images, ratio, now);
  if (ios) {
    try {
      // plain JSON only (a null inside props made updateTimeline throw in mood-journal): undefined fields are dropped
      ios.CardsWidget.updateSnapshot(JSON.parse(JSON.stringify(data)) as WidgetData);
    } catch (e) {
      console.warn('[widgets] ios snapshot', e instanceof Error ? e.message : e);
    }
  }
  if (CardsWidgetNative) CardsWidgetNative.setData(JSON.stringify(data));
  console.log(`[widgets] pushed ${data.cards.length} cards, ${images.size} codes (ratio ${ratio}) in ${Math.round(performance.now() - started)} ms`);
  return data;
}

let appDb: Db | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** Debounced push (default 400 ms; after a card open 2 s, SPEC §6.4). */
export function requestWidgetSync(delayMs = 400): void {
  if (!appDb) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const db = appDb;
    if (db) queue = queue.then(() => pushWidgets(db)).catch((e) => console.warn(`[widgets] push failed: ${String(e)}`));
  }, delayMs);
}

/** App start: push now, then whenever the app goes to the background. */
export function startWidgets(db: Db): void {
  if (appDb) return;
  appDb = db;
  // not on the start-up path: the first screen and the user's first taps come first (the PNG writes take tens of ms)
  requestWidgetSync(3000);
  AppState.addEventListener('change', (state) => {
    if (state === 'background') requestWidgetSync(0);
  });
}

/** Android "Add to home screen" (launcher dialog); null on iOS. */
export function requestPinWidget(kind: 'grid' | 'barcode'): 'requested' | 'alreadyAdded' | 'unsupported' | null {
  return CardsWidgetNative ? CardsWidgetNative.requestPinWidget(kind) : null;
}

export function androidWidgetCount(): number {
  return CardsWidgetNative ? CardsWidgetNative.widgetCount() : 0;
}

/**
 * @jest-environment node
 */
import { FORMATS, type FormatId } from '@/engine/barcode/formats';
import { layout } from '@/engine/barcode/layout';
import { toPng } from '@/engine/barcode/png';
import { renderMatrix } from '@/engine/barcode/render';

import { buildCodeCache } from './code-cache';
import { buildWidgetData, cardsNeedingImages, shortcutItems, shortcutsKey, WIDGET_CODE_BOX, widgetPngPlan, type WidgetWords } from './widget-data';
import { matrixFromCache, widgetPng } from './widget-png';

const ihdr = (png: Uint8Array) => {
  const v = new DataView(png.buffer, png.byteOffset);
  return { w: v.getUint32(16), h: v.getUint32(20) };
};

describe('widget PNG scale comes from layout() (P7)', () => {
  it.each([
    ['ean13', '4006381333931'],
    ['code128', 'CARD12345678'],
    ['upce', '01234565'],
    ['code39', 'LIB 0042'],
  ] as const)('%s fits the iOS and Android 1D boxes at an integer module ≥ the minimum', (format, value) => {
    for (const platform of ['ios', 'android'] as const) {
      for (const ratio of [2, 2.625, 3]) {
        const box = WIDGET_CODE_BOX[platform]['1d'];
        const m = renderMatrix(value, format);
        const plan = widgetPngPlan(m, FORMATS[format].minModulePx, box, ratio);
        const l = layout(m, { widthPx: box.width, heightPx: box.height }, FORMATS[format].minModulePx, ratio);
        if (l.rotate || l.dense) {
          // too long for this box at this density: no PNG (only possible below ratio 3 for these values)
          expect(plan).toBeNull();
          expect(ratio).toBeLessThan(3);
          continue;
        }
        expect(plan).toEqual({ modulePx: l.modulePx, barHeightPx: l.heightPx });
        expect(Number.isInteger(plan!.modulePx)).toBe(true);
        expect(plan!.modulePx).toBeGreaterThanOrEqual(3);
        const png = widgetPng(value, format, null, box, ratio)!;
        expect(png.modulePx).toBe(plan!.modulePx);
        expect(ihdr(png.png)).toEqual({ w: png.widthPx, h: png.heightPx });
        expect(png.widthPx).toBe(m.modulesWide * plan!.modulePx);
        expect(png.widthPx).toBeLessThanOrEqual(Math.floor(box.width * ratio));
        // bar height: layout's height rounded up to whole modules (toPng), never more than one module over the box
        expect(png.heightPx).toBeLessThanOrEqual(Math.floor(box.height * ratio) + plan!.modulePx);
      }
    }
  });

  it('a 1D code that layout() would rotate gets no widget PNG (the widget shows the tile + Open)', () => {
    const value = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0';
    const m = renderMatrix(value, 'code128');
    const box = WIDGET_CODE_BOX.ios['1d'];
    expect(layout(m, { widthPx: box.width, heightPx: box.height }, 3, 3).rotate).toBe(true);
    expect(widgetPng(value, 'code128', null, box, 3)).toBeNull();
  });

  it('a 2D PNG comes from the render-once cache and equals the engine PNG at the same scale (no second encode)', () => {
    for (const [format, value] of [
      ['qr', 'CARD-123456789012'],
      ['aztec', 'AZ1234567890'],
      ['datamatrix', 'DM1234567890'],
      ['pdf417', 'PDF12345'],
    ] as [FormatId, string][]) {
      const cache = buildCodeCache(value, format)!;
      const box = WIDGET_CODE_BOX.ios['2d'];
      const png = widgetPng(value, format, cache, box, 3);
      if (format === 'pdf417') {
        // PDF417 is wide: in a square widget box it would fall under 4 px per module → no PNG (honest, L26)
        const m = renderMatrix(value, format);
        const l = layout(m, { widthPx: box.width, heightPx: box.height }, 4, 3);
        expect(png === null).toBe(l.dense);
        continue;
      }
      expect(png).not.toBeNull();
      expect(png!.modulePx).toBeGreaterThanOrEqual(4);
      const engine = toPng(renderMatrix(value, format), { modulePx: png!.modulePx });
      expect(Buffer.from(png!.png).equals(Buffer.from(engine.png))).toBe(true);
      expect(matrixFromCache(format, cache).modulesWide).toBe(cache.modulesWide);
    }
    // without a cache entry a 2D code is never drawn in a widget
    expect(widgetPng('CARD-1', 'qr', null, WIDGET_CODE_BOX.ios['2d'], 3)).toBeNull();
  });

  it('a heavy 2D code too dense for the widget box gets no PNG', () => {
    const value = '日'.repeat(500);
    const cache = buildCodeCache(value, 'aztec')!;
    expect(widgetPng(value, 'aztec', cache, WIDGET_CODE_BOX.ios['2d'], 3)).toBeNull();
  });

  it('number-only cards never get a PNG', () => {
    expect(widgetPng('123', 'none', null, WIDGET_CODE_BOX.android['1d'], 3)).toBeNull();
  });
});

const base = { favourite: false, archived: false, useCount: 0, lastUsedAt: null as number | null, createdAt: 1, color: '#ffcc00', number: '1234567890123', format: 'ean13' as FormatId };
const card = (id: string, extra: Partial<typeof base> & { sortIndex: number; name?: string }) => ({ ...base, id, name: extra.name ?? `Card ${id}`, ...extra });
const words: WidgetWords = { title: 'Cards', open: 'Open', empty: 'Add a card', noCode: 'Open to show the code' };

describe('widget data', () => {
  const cards = [
    card('a', { sortIndex: 0, useCount: 2, name: 'Alpha Shop' }),
    card('b', { sortIndex: 1, favourite: true, color: '#202020' }),
    card('c', { sortIndex: 2, archived: true, favourite: true }),
    card('d', { sortIndex: 3, useCount: 9, format: 'none' }),
  ];

  it('orders chosen, favourites, most used; links, numbers, colours; archived never shown', () => {
    const images = new Map([['b', { uri: 'file:///g/b.png', widthPx: 900, heightPx: 186 }]]);
    const data = buildWidgetData(cards, ['a'], 'loyaltycards-dev', words, images, 3, 42);
    expect(data.cards.map((c) => c.id)).toEqual(['a', 'b', 'd']);
    expect(data.cards[0]).toMatchObject({ url: 'loyaltycards-dev://card/a', initials: 'AS', fg: '#000000', number: '1234 5678 9012 3', kind: '1d' });
    expect(data.cards[1]).toMatchObject({ fg: '#ffffff', image: { uri: 'file:///g/b.png', width: 300, height: 62 } });
    expect(data.cards[2].kind).toBe('none');
    expect(data).toMatchObject({ appUrl: 'loyaltycards-dev://', updatedAt: 42, title: 'Cards' });
  });

  it('asks for images only for barcode cards of the snapshot', () => {
    expect(cardsNeedingImages(cards, [], 1).map((c) => c.id)).toEqual(['b', 'a']);
  });
});

describe('app shortcuts (A11)', () => {
  it('are the 4 most-used live cards, each opening /card/<id>', () => {
    const many = [
      card('1', { sortIndex: 0, useCount: 1 }),
      card('2', { sortIndex: 1, useCount: 5 }),
      card('3', { sortIndex: 2, useCount: 3, archived: true }),
      card('4', { sortIndex: 3, useCount: 4 }),
      card('5', { sortIndex: 4, useCount: 2, lastUsedAt: 10 }),
      card('6', { sortIndex: 5, useCount: 0 }),
    ];
    const items = shortcutItems(many);
    expect(items.map((i) => i.id)).toEqual(['card-2', 'card-4', 'card-5', 'card-1']);
    expect(items[0]).toEqual({ id: 'card-2', title: 'Card 2', subtitle: '1234 5678 9012 3', params: { href: '/card/2' } });
    expect(shortcutsKey(items)).toBe(shortcutsKey(shortcutItems(many)));
    expect(shortcutsKey(items)).not.toBe(shortcutsKey(shortcutItems(many, 3)));
  });
});

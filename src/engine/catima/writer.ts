// Catima export, version 2 (D17): zip with `catima.csv` (RFC 4180, CRLF, UTF-8; version line, groups, cards, links)
// and `card_<id>_<front|back|icon>.png`. Ids are 1-based integers (Catima's image regex needs digits). `expiry`/`validfrom`
// in ms, `lastused` in seconds, `headercolor` as a signed Android int, `barcodeencoding` UTF-8. Lossless for every
// field Catima knows (A4); our extra fields (tile, chain, use count) live in the own backup only.
import { FORMATS } from '../barcode/formats';
import type { CardData, CardImages } from '../card-data';
import { writeCsv } from '../csv-core';
import { isCurrencyCode } from '../currency';
import { isPng } from '../image-bytes';
import { utf8, writeZip } from '../zip';

import { hexToCatimaColor } from './color';

export const CATIMA_CARD_COLUMNS = ['_id', 'store', 'note', 'validfrom', 'expiry', 'balance', 'balancetype', 'cardid', 'barcodeid', 'barcodetype', 'barcodeencoding', 'headercolor', 'starstatus', 'lastused', 'archive'] as const;

/**
 * `lastused` in Unix seconds; a card never used is an EMPTY cell (D45.3), the way our `validfrom`/`expiry` cells say
 * "none". Catima's importer reads an empty cell as 0 (CatimaImporter: extractLong throws on '', caught → 0L), so Catima
 * sees the same card it would see for `0`; our reader reads '' (and 0) back as never used.
 */
function lastUsedSeconds(ms: number | null): string {
  const s = ms === null ? 0 : Math.floor(ms / 1000);
  return s > 0 ? String(s) : '';
}

export type ExportCard = CardData & { images?: CardImages };

/** A card our export cannot give Catima (CatimaImporter.java @07b385d line 448: an empty `cardid` aborts the import). */
export type CatimaOmitted = { index: number; name: string; reason: 'noNumber' };
/**
 * A field written empty/0 because Catima would reject it (line 443: Currency.getInstance) or read it as 0 (line 435); or
 * a photo (`field: 'image'`, `value` = the side) left out because its bytes are not PNG — Catima's zip only has `.png`
 * entries (lines 79–87) and we never write other bytes under that name (B2 CE-05). The export flow converts the stored
 * JPEG photos to PNG before calling the writer (P6).
 */
export type CatimaDropped = { index: number; name: string; field: 'balance' | 'balanceCurrency' | 'image'; value: string };
export type CatimaExport = { zip: Uint8Array; exported: number; omitted: CatimaOmitted[]; dropped: CatimaDropped[] };

/** Our balance as Java's BigDecimal reads it: '' → 0; '12,50' → '12.50'; anything not a plain decimal → not ok. */
export function catimaBalance(balance: string): { ok: boolean; value: string } {
  const s = balance.trim().replace(',', '.');
  if (s === '') return { ok: true, value: '0' };
  return /^-?\d+(\.\d+)?$/.test(s) ? { ok: true, value: s } : { ok: false, value: '0' };
}

type Planned = { card: ExportCard; index: number; balance: string; currency: string };

/**
 * Review M5: Catima's importer has no per-card isolation — one bad row loses the whole file. So a card without a number
 * is left out (and reported), a non-ISO balance type is written empty (= points) and an unreadable balance as 0 (both
 * reported). The UI shows `omitted`/`dropped` before sharing (SPEC §2 exact summaries).
 */
export function planCatimaExport(cards: readonly ExportCard[]): { planned: Planned[]; omitted: CatimaOmitted[]; dropped: CatimaDropped[] } {
  const planned: Planned[] = [];
  const omitted: CatimaOmitted[] = [];
  const dropped: CatimaDropped[] = [];
  cards.forEach((card, index) => {
    if (card.number.trim() === '') {
      omitted.push({ index, name: card.name, reason: 'noNumber' });
      return;
    }
    const b = catimaBalance(card.balance);
    if (!b.ok) dropped.push({ index, name: card.name, field: 'balance', value: card.balance });
    let currency = card.balanceCurrency;
    if (currency !== '' && !isCurrencyCode(currency)) {
      dropped.push({ index, name: card.name, field: 'balanceCurrency', value: currency });
      currency = '';
    }
    planned.push({ card, index, balance: b.value, currency });
  });
  return { planned, omitted, dropped };
}

function csvOf(planned: readonly Planned[], groups?: readonly string[]): string {
  const groupNames = groups ?? [...new Set(planned.flatMap((p) => p.card.categories))];
  const lines: string[][] = [['2'], []];
  lines.push(['_id'], ...groupNames.map((g) => [g]), []);
  lines.push([...CATIMA_CARD_COLUMNS]);
  planned.forEach(({ card: c, balance, currency }, i) => {
    lines.push([
      String(i + 1),
      c.name,
      c.note,
      c.validFrom === null ? '' : String(c.validFrom),
      c.expiry === null ? '' : String(c.expiry),
      balance,
      currency,
      c.number,
      c.codeValue === '' || c.codeValue === c.number ? '' : c.codeValue,
      FORMATS[c.format].catima ?? '',
      'UTF-8',
      String(hexToCatimaColor(c.color)),
      c.favourite ? '1' : '0',
      lastUsedSeconds(c.lastUsedAt),
      c.archived ? '1' : '0',
    ]);
  });
  lines.push([], ['cardId', 'groupId']);
  planned.forEach(({ card: c }, i) => {
    for (const g of c.categories) if (groupNames.includes(g)) lines.push([String(i + 1), g]);
  });
  return writeCsv(lines);
}

/** The CSV text of a version-2 export (cards Catima would reject are left out; use writeCatimaZip for the report). */
export function writeCatimaCsv(cards: readonly ExportCard[], groups?: readonly string[]): string {
  return csvOf(planCatimaExport(cards).planned, groups);
}

/** The zip bytes (catima.csv first, then the images) and what could not go to Catima. */
export function writeCatimaZip(cards: readonly ExportCard[], groups?: readonly string[]): CatimaExport {
  const { planned, omitted, dropped } = planCatimaExport(cards);
  const entries: Record<string, Uint8Array> = { 'catima.csv': utf8.encode(csvOf(planned, groups)) };
  planned.forEach(({ card: c, index }, i) => {
    for (const side of ['front', 'back', 'icon'] as const) {
      const bytes = c.images?.[side];
      if (!bytes) continue;
      if (isPng(bytes)) entries[`card_${i + 1}_${side}.png`] = bytes;
      else dropped.push({ index, name: c.name, field: 'image', value: side });
    }
  });
  return { zip: writeZip(entries), exported: planned.length, omitted, dropped };
}

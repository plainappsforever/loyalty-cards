// Catima import (D17, RESEARCH §2.7; format confirmed in the Catima source 2026-10-16, D29): a zip with `catima.csv` and
// `card_<id>_<front|back|icon>.png`, or a bare CSV (pre-2.0). Version line `2` → three sections (groups, cards, links)
// separated by blank lines; version 1 → one cards table. Tolerant: missing columns, multi-line notes, unknown barcode
// types (→ `none`, the raw type kept in the note), signed-int colours, empty values. `expiry`/`validfrom` are Unix MS,
// `lastused` Unix SECONDS (Catima's Utils.getUnixTime = currentTimeMillis / 1000). Never overwrites: the caller plans.
import { formatFromCatima } from '../barcode/formats';
import { cleanBalance, cleanName, cleanTimestampMs, currencyKeepingNote, mergeCategories, type ImportedCard, type Skipped } from '../card-data';
import { parseCsv } from '../csv-core';
import { checkImportedCode } from '../import-check';
import { isZip, readZip, utf8, zipEncryption } from '../zip';

import { catimaColorToHex, colorForName } from './color';

export type CatimaImport = {
  version: 1 | 2;
  cards: ImportedCard[];
  /** Group names in file order (also on each card as `categories`). */
  groups: string[];
  skipped: Skipped[];
  /** Image files that matched no imported card (information only). */
  unusedImages: number;
  /** Store names cut to 80 characters (review R8; the UI mentions it). */
  truncatedNames: number;
  /** Cards whose number does not fit their barcode type: imported as number only, reason in the note (review M1). */
  invalidCodes: number;
};

export type CatimaReadError = 'encrypted' | 'noCsv' | 'notCatima';

export class CatimaFormatError extends Error {
  readonly code: CatimaReadError;
  constructor(code: CatimaReadError) {
    super(code);
    this.code = code; // plain field: the Node script loader (type stripping) cannot run parameter properties
  }
}

/** Reads a Catima zip or CSV (bytes). Throws CatimaFormatError for an encrypted zip, a zip without catima.csv, or text without a cards table. */
export function readCatima(bytes: Uint8Array): CatimaImport {
  if (isZip(bytes)) {
    if (zipEncryption(bytes) === 'encrypted') throw new CatimaFormatError('encrypted');
    const entries = readZip(bytes);
    const csvName = Object.keys(entries).find((n) => n.toLowerCase() === 'catima.csv');
    if (!csvName) throw new CatimaFormatError('noCsv');
    return parseCatimaCsv(utf8.decode(entries[csvName]), entries);
  }
  return parseCatimaCsv(utf8.decode(bytes), {});
}

const IMAGE_RE = /^card_(\d+)_(front|back|icon)\.png$/i;
/** Category names are 1–40 characters in our database (CHECK); cut like the backup reader does (review S7). Counted in
 *  code points like SQLite's length(), never UTF-16 units (a cut could split a surrogate pair; B2 A24, D39). */
const cleanGroup = (g: string): string => [...g.replace(/\s+/g, ' ').trim()].slice(0, 40).join('').trim();

/** Parses the CSV text; `files` are the zip entries for images (empty for a bare CSV). */
export function parseCatimaCsv(text: string, files: Record<string, Uint8Array> = {}): CatimaImport {
  const rows = parseCsv(text);
  const isBlank = (r: string[] | undefined) => !r || r.every((f) => f.trim() === '');
  // version line: digits only on the first non-blank row's first field (Catima: non-digit → version 1)
  let i = 0;
  while (i < rows.length && isBlank(rows[i])) i++;
  const first = rows[i];
  const version: 1 | 2 = first && first.length === 1 && /^\d{1,5}$/.test(first[0].trim()) ? (first[0].trim() === '2' ? 2 : 1) : 1;
  const skipped: Skipped[] = [];
  let groups: string[] = [];
  let cardRows: { header: string[]; rows: { line: number; fields: string[] }[] } | null = null;
  let links: { cardId: string; groupId: string }[] = [];

  const readTable = (start: number): { header: string[]; rows: { line: number; fields: string[] }[]; next: number } => {
    const header = rows[start].map((h) => h.trim().toLowerCase());
    const out: { line: number; fields: string[] }[] = [];
    let j = start + 1;
    while (j < rows.length && !isBlank(rows[j])) {
      out.push({ line: j + 1, fields: rows[j] });
      j++;
    }
    return { header, rows: out, next: j };
  };

  if (version === 2) {
    let j = i + 1;
    let section = 0;
    while (j < rows.length) {
      if (isBlank(rows[j])) {
        j++;
        continue;
      }
      const t = readTable(j);
      j = t.next;
      if (section === 0 && t.header[0] === '_id' && t.header.length === 1) groups = [...new Set(t.rows.map((r) => cleanGroup(r.fields[0] ?? '')).filter((g) => g !== ''))];
      else if (section <= 1 && t.header.includes('store')) cardRows = t;
      else if (t.header.includes('cardid') && t.header.includes('groupid')) {
        const ci = t.header.indexOf('cardid');
        const gi = t.header.indexOf('groupid');
        links = t.rows.map((r) => ({ cardId: r.fields[ci] ?? '', groupId: cleanGroup(r.fields[gi] ?? '') }));
      }
      section++;
    }
  } else {
    // version 1: the whole file is one cards table (the first non-blank row is its header)
    if (first && first.map((h) => h.trim().toLowerCase()).includes('store')) cardRows = readTable(i);
  }
  if (!cardRows) throw new CatimaFormatError('notCatima');

  const h = cardRows.header;
  const col = (fields: string[], name: string): string | undefined => {
    const k = h.indexOf(name);
    return k >= 0 ? fields[k] : undefined;
  };
  const linksByCard = new Map<string, string[]>();
  for (const l of links) {
    if (!linksByCard.has(l.cardId)) linksByCard.set(l.cardId, []);
    linksByCard.get(l.cardId)!.push(l.groupId);
  }
  const images = new Map<string, Record<string, Uint8Array>>();
  for (const [name, bytes] of Object.entries(files)) {
    const m = IMAGE_RE.exec(name.split('/').pop() ?? '');
    if (!m) continue;
    if (!images.has(m[1])) images.set(m[1], {});
    images.get(m[1])![m[2].toLowerCase()] = bytes;
  }
  const usedImages = new Set<string>();
  const cards: ImportedCard[] = [];
  let truncatedNames = 0;
  let invalidCodes = 0;
  for (const { line, fields } of cardRows.rows) {
    const rawName = (col(fields, 'store') ?? '').replace(/\s+/g, ' ').trim();
    const name = cleanName(rawName);
    if (name.length < rawName.length) truncatedNames++;
    const number = (col(fields, 'cardid') ?? '').trim();
    if (name === '' && number === '') {
      skipped.push({ row: line, reason: 'badRow' });
      continue;
    }
    if (name === '') {
      skipped.push({ row: line, reason: 'emptyName' });
      continue;
    }
    if (number === '') {
      skipped.push({ row: line, reason: 'emptyNumber' });
      continue;
    }
    const rawType = (col(fields, 'barcodetype') ?? '').trim();
    const format = rawType === '' ? 'none' : formatFromCatima(rawType);
    let note = (col(fields, 'note') ?? '').replace(/\r\n?/g, '\n');
    if (rawType !== '' && !format) note = note === '' ? `Catima type: ${rawType.toUpperCase()}` : `${note}\nCatima type: ${rawType.toUpperCase()}`;
    const codeValue = (col(fields, 'barcodeid') ?? '').trim();
    const id = (col(fields, '_id') ?? '').trim();
    const img = images.get(id) ?? {};
    if (images.has(id)) usedImages.add(id);
    const unit = currencyKeepingNote(col(fields, 'balancetype') ?? '', note);
    const code = checkImportedCode({ number, codeValue: codeValue === number ? '' : codeValue, format: format ?? 'none', note: unit.note });
    if (code.invalid) invalidCodes++;
    note = code.note;
    cards.push({
      name,
      number,
      codeValue: codeValue === number ? '' : codeValue,
      format: code.format,
      color: catimaColorToHex(col(fields, 'headercolor')) ?? colorForName(name),
      note,
      balance: cleanBalance(col(fields, 'balance') ?? ''),
      balanceCurrency: unit.currency,
      validFrom: cleanTimestampMs(col(fields, 'validfrom'), 'ms'),
      expiry: cleanTimestampMs(col(fields, 'expiry'), 'ms'),
      favourite: (col(fields, 'starstatus') ?? '').trim() === '1',
      archived: (col(fields, 'archive') ?? '').trim() === '1',
      lastUsedAt: cleanTimestampMs(col(fields, 'lastused'), 's'),
      categories: [...new Set((linksByCard.get(id) ?? []).filter((g) => g !== ''))],
      images: { front: img.front, back: img.back, icon: img.icon },
    });
  }
  // groups that only appear in links still count; "Food"/"food" are one (first spelling wins, D33 Q5)
  groups = mergeCategories([...groups, ...links.map((l) => l.groupId).filter((g) => g !== '')], cards);
  return { version, cards, groups, skipped, unusedImages: images.size - usedImages.size, truncatedNames, invalidCodes };
}

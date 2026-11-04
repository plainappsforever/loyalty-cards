// Generic CSV (SPEC §5.4): import with header detection (name|store, number|cardid|id, format|barcodetype|type, note…),
// delimiter detection (`,` `;` tab), BOM, CRLF; an unknown/missing format → the first `suggestFormats` match; a declared
// format the number cannot hold → number only with the reason (never another format, D36). No header (an empty or
// BOM-only file included) → refused; columns it does not know are ignored, never a reason to refuse (D45). Export
// with a fixed header. Formula-leading cells are guarded on export (spreadsheet injection).
import { formatFromCatima, formatFromHint, type FormatId } from './barcode/formats';
import { suggestFormats, validate } from './barcode/validate';
import { cleanBalance, cleanName, cleanTimestampMs, COLOR_RE, currencyKeepingNote, mergeCategories, type CardData, type ImportedCard, type Skipped } from './card-data';
import { colorForName } from './catima/color';
import { checkImportedCode } from './import-check';
import { detectDelimiter, parseCsv, writeCsv } from './csv-core';

export const CSV_COLUMNS = ['name', 'number', 'code', 'format', 'note', 'color', 'balance', 'currency', 'valid_from', 'expiry', 'favourite', 'archived', 'categories'] as const;

const HEADER_ALIASES: Record<string, readonly string[]> = {
  name: ['name', 'store', 'shop', 'card', 'cardname', 'card name', 'title', 'company', 'merchant'],
  // most specific first; a bare 'id' (often a row id) only when nothing better is there (review S3)
  number: ['number', 'card number', 'cardnumber', 'cardid', 'card id', 'card_id', 'membership', 'barcode', 'code', 'value', 'id'],
  code: ['code', 'codevalue', 'code_value', 'barcodeid', 'barcode id', 'barcode_id', 'barcodevalue', 'barcode value'],
  format: ['format', 'barcodetype', 'barcode type', 'barcode_type', 'type', 'symbology'],
  note: ['note', 'notes', 'comment', 'comments', 'description'],
  color: ['color', 'colour', 'headercolor'],
  balance: ['balance', 'points', 'credit'],
  currency: ['currency', 'balancetype', 'balance type'],
  valid_from: ['valid_from', 'validfrom', 'valid from'],
  expiry: ['expiry', 'expires', 'expiration', 'valid_until', 'valid until'],
  favourite: ['favourite', 'favorite', 'starred', 'starstatus'],
  archived: ['archived', 'archive'],
  categories: ['categories', 'category', 'groups', 'group', 'tags'],
};

export type CsvErrorCode = 'noHeader';

/** The file is not a card list we can read (no recognised header row). */
export class CsvFormatError extends Error {
  readonly code: CsvErrorCode;
  constructor(code: CsvErrorCode) {
    super(code);
    this.code = code; // plain field: the Node script loader (type stripping) cannot run parameter properties
  }
}

/** `invalidCodes`: cards whose number does not fit the format the file declares — imported as number only (SPEC §5.1). */
export type CsvImport = { cards: ImportedCard[]; skipped: Skipped[]; delimiter: string; columns: Record<string, number>; invalidCodes: number };

function mapHeader(header: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const norm = header.map((h) => h.trim().toLowerCase().replace(/^﻿/, ''));
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const a of aliases) {
      const i = norm.indexOf(a);
      if (i >= 0 && !Object.values(out).includes(i)) {
        out[key] = i;
        break;
      }
    }
  }
  return out;
}

/** A loose type name → our id (Catima names, our ids, "Code 128", "EAN13", "number only", …); undefined when unknown. */
export function formatFromLooseName(name: string): FormatId | undefined {
  if (/^(none|number only)$/i.test(name.trim())) return 'none';
  return formatFromCatima(name) ?? formatFromHint(name);
}

export function parseGenericCsv(text: string): CsvImport {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = detectDelimiter(firstLine);
  // our own export guards formula-leading cells with ' (guardCell); a spreadsheet hides it — reading it back removes it (review S2)
  const rows = parseCsv(clean, { delimiter }).map((r) => r.map(unguardCell));
  const skipped: Skipped[] = [];
  const cards: ImportedCard[] = [];
  let invalidCodes = 0;
  // an empty or BOM-only file has no header row either: refused like any other headerless file, never "0 cards"
  // (B3 GC-34/36, D45.1)
  if (rows.length === 0) throw new CsvFormatError('noHeader');
  const columns = mapHeader(rows[0]);
  // no recognisable name and number columns: refused, never guessed from positions (D37 — a guess turns a row id or a
  // date column into card numbers without anyone noticing)
  if (columns.name === undefined || columns.number === undefined) throw new CsvFormatError('noHeader');
  const get = (fields: string[], key: string): string => (columns[key] === undefined ? '' : (fields[columns[key]] ?? ''));
  for (let r = 1; r < rows.length; r++) {
    const fields = rows[r];
    if (fields.every((f) => f.trim() === '')) continue;
    const name = cleanName(get(fields, 'name'));
    const number = get(fields, 'number').trim();
    if (name === '' && number === '') {
      skipped.push({ row: r + 1, reason: 'badRow' });
      continue;
    }
    if (name === '') {
      skipped.push({ row: r + 1, reason: 'emptyName' });
      continue;
    }
    if (number === '') {
      skipped.push({ row: r + 1, reason: 'emptyNumber' });
      continue;
    }
    const code = get(fields, 'code').trim();
    const typeName = get(fields, 'format').trim();
    const codeForFormat = code !== '' ? code : number;
    // a DECLARED format is kept even when the number does not fit it — checkImportedCode then stores it as number only
    // with the reason (SPEC §5.1, D36); only a missing or unknown type name gets the first suggestion the value is VALID
    // for, never one with a check digit added (review M2), and an unknown name stays visible in the note
    let format = typeName === '' ? undefined : formatFromLooseName(typeName);
    let note = get(fields, 'note');
    if (!format) {
      format = suggestFormats(codeForFormat).find((sg) => validate(codeForFormat, sg.format).ok)?.format ?? 'none';
      if (typeName !== '') note = note === '' ? `Type: ${typeName}` : `${note}\nType: ${typeName}`;
    }
    const unit = currencyKeepingNote(get(fields, 'currency'), note);
    const checked = checkImportedCode({ number, codeValue: code === number ? '' : code, format, note: unit.note });
    format = checked.format;
    note = checked.note;
    if (checked.invalid) invalidCodes++;
    const colorRaw = get(fields, 'color').trim().toLowerCase();
    const color = COLOR_RE.test(colorRaw) ? colorRaw : colorForName(name);
    cards.push({
      name,
      number,
      codeValue: code === number ? '' : code,
      format,
      color,
      note,
      balance: cleanBalance(get(fields, 'balance')),
      balanceCurrency: unit.currency,
      validFrom: cleanTimestampMs(get(fields, 'valid_from')) ?? dateMs(get(fields, 'valid_from')),
      expiry: cleanTimestampMs(get(fields, 'expiry')) ?? dateMs(get(fields, 'expiry')),
      favourite: /^(1|true|yes)$/i.test(get(fields, 'favourite').trim()),
      archived: /^(1|true|yes)$/i.test(get(fields, 'archived').trim()),
      lastUsedAt: null,
      categories: get(fields, 'categories')
        .split(/[;|]/)
        .map((g) => g.trim())
        .filter((g) => g !== ''),
      images: {},
    });
  }
  mergeCategories([], cards); // "Food"/"food" are one category, first spelling wins (D33 Q5)
  return { cards, skipped, delimiter, columns, invalidCodes };
}

/** ISO date (YYYY-MM-DD) → Unix ms at UTC midnight; null otherwise. */
export function dateMs(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) && t > 0 ? t : null;
}

export function isoDate(ms: number | null): string {
  return ms === null ? '' : new Date(ms).toISOString().slice(0, 10);
}

/** A cell starting with = + - @ or a tab/CR is prefixed with ' so spreadsheets do not run it as a formula. */
export function guardCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Inverse of guardCell for import: "'=x" → "=x"; any other leading apostrophe stays. */
export function unguardCell(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

export function writeGenericCsv(cards: readonly CardData[]): string {
  const rows: string[][] = [[...CSV_COLUMNS]];
  for (const c of cards) {
    rows.push([c.name, c.number, c.codeValue, c.format, c.note, c.color, c.balance, c.balanceCurrency, isoDate(c.validFrom), isoDate(c.expiry), c.favourite ? '1' : '0', c.archived ? '1' : '0', c.categories.join('; ')].map(guardCell));
  }
  return writeCsv(rows);
}

// Family sharing without a server (D18, SPEC §5.4): `LC1:` + compact JSON, shown as a QR and scanned by the other phone's
// Add screen. ≤ 1,200 bytes (UTF-8): the note is truncated with "…" and the result says so. The parser accepts nothing else.
import { isFormatId, type FormatId } from './barcode/formats';
import { cleanBalance, cleanName, COLOR_RE, type CardData } from './card-data';
import { colorForName } from './catima/color';
import { isCurrencyCode } from './currency';
import { checkImportedCode } from './import-check';

export const SHARE_PREFIX = 'LC1:';
export const SHARE_MAX_BYTES = 1200;

type Wire = { n: string; i: string; c?: string; f: FormatId; k?: string; t?: string; b?: string; u?: string; e?: number; v?: number };

const bytes = (s: string): number => new TextEncoder().encode(s).length;

/** `tooLarge`: even without a note the card does not fit 1,200 bytes (huge code value or name) — the UI offers "Send as
 * file" instead of a QR; the note is then left whole and not blamed (review S4). */
export type SharePayload = { text: string; bytes: number; noteTruncated: boolean; tooLarge: boolean };

export function buildSharePayload(card: Pick<CardData, 'name' | 'number' | 'codeValue' | 'format' | 'color' | 'note' | 'balance' | 'balanceCurrency' | 'expiry' | 'validFrom'>): SharePayload {
  const base: Wire = { n: card.name, i: card.number, f: card.format, k: card.color };
  if (card.codeValue !== '' && card.codeValue !== card.number) base.c = card.codeValue;
  if (card.balance !== '') base.b = card.balance;
  if (card.balanceCurrency !== '') base.u = card.balanceCurrency;
  if (card.expiry !== null) base.e = card.expiry;
  if (card.validFrom !== null) base.v = card.validFrom;
  const encode = (note: string): string => SHARE_PREFIX + JSON.stringify(note === '' ? base : { ...base, t: note });
  let note = card.note;
  let text = encode(note);
  let truncated = false;
  if (bytes(encode('')) > SHARE_MAX_BYTES) return { text, bytes: bytes(text), noteTruncated: false, tooLarge: true };
  if (bytes(text) > SHARE_MAX_BYTES && note !== '') {
    truncated = true;
    const chars = [...note];
    let lo = 0;
    let hi = chars.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (bytes(encode(chars.slice(0, mid).join('') + '…')) <= SHARE_MAX_BYTES) lo = mid;
      else hi = mid - 1;
    }
    note = lo === 0 ? '' : chars.slice(0, lo).join('') + '…';
    text = encode(note);
  }
  return { text, bytes: bytes(text), noteTruncated: truncated, tooLarge: false };
}

const WIRE_KEYS: readonly string[] = ['n', 'i', 'c', 'f', 'k', 't', 'b', 'u', 'e', 'v'];
const isMs = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const optional = (v: unknown, ok: (x: unknown) => boolean): boolean => v === undefined || ok(v);
const isString = (v: unknown): v is string => typeof v === 'string';

/**
 * Parses a scanned string; null when it is not an `LC1:` payload or ANY field is malformed (SPEC §5.4, D38): our own
 * format is read exactly as the writer writes it — unknown key, a non-string text field, `t: null`, an expiry/valid-from
 * that is not a positive integer of milliseconds, a balance that is not a decimal string, a currency that is not an
 * upper-case ISO 4217 code, a colour that is not lower-case `#rrggbb` — refuse the whole payload; nothing is ignored,
 * blanked or repaired. `k` may be absent (colour from the name, D33 Q1).
 */
export function parseSharePayload(text: string): CardData | null {
  if (!text.startsWith(SHARE_PREFIX)) return null;
  let w: unknown;
  try {
    w = JSON.parse(text.slice(SHARE_PREFIX.length));
  } catch {
    return null;
  }
  if (typeof w !== 'object' || w === null || Array.isArray(w)) return null;
  if (Object.keys(w).some((key) => !WIRE_KEYS.includes(key))) return null;
  const o = w as Partial<Record<keyof Wire, unknown>>;
  if (!isString(o.n) || !isString(o.i) || !isFormatId(o.f)) return null;
  if (!optional(o.k, (k) => isString(k) && COLOR_RE.test(k))) return null;
  if (!optional(o.c, isString) || !optional(o.t, isString)) return null;
  if (!optional(o.b, (b) => isString(b) && /^-?\d+([.,]\d+)?$/.test(b))) return null;
  if (!optional(o.u, (u) => isString(u) && isCurrencyCode(u))) return null;
  if (!optional(o.e, isMs) || !optional(o.v, isMs)) return null;
  const name = cleanName(o.n);
  // our own format: a name over 80 characters is refused, never cut (B1 LC1-P15, same rule as the backup reader)
  if (name === '' || name !== o.n.replace(/\s+/g, ' ').trim() || o.i === '') return null;
  const codeValue = isString(o.c) && o.c !== o.i ? o.c : '';
  const code = checkImportedCode({ number: o.i, codeValue, format: o.f, note: isString(o.t) ? o.t : '' });
  return {
    name,
    number: o.i,
    codeValue,
    format: code.format,
    color: isString(o.k) ? o.k : colorForName(name),
    note: code.note,
    balance: cleanBalance(isString(o.b) ? o.b : ''),
    balanceCurrency: isString(o.u) ? o.u : '',
    validFrom: isMs(o.v) ? o.v : null,
    expiry: isMs(o.e) ? o.e : null,
    favourite: false,
    archived: false,
    lastUsedAt: null,
    categories: [],
  };
}

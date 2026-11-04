// Catima share URLs (RESEARCH §2.7, docs/CARD_SHARING_URL_FORMAT.md): 2.0 form = fragment, every value URL-encoded, the
// whole key=value string URL-encoded again; legacy form = query string, values encoded once (import only).
import { formatFromCatima, FORMATS, type FormatId } from '../barcode/formats';
import { catimaBalance } from './writer';
import { cleanBalance, cleanName, currencyKeepingNote } from '../card-data';
import { isCurrencyCode } from '../currency';
import { checkImportedCode } from '../import-check';

import { catimaColorToHex, hexToCatimaColor } from './color';

export const CATIMA_SHARE_HOSTS: readonly { host: string; path: string }[] = [
  { host: 'catima.app', path: '/share' },
  { host: 'thelastproject.github.io', path: '/Catima/share' },
  { host: 'brarcher.github.io', path: '/loyalty-card-locker/share' },
];

export type SharedCard = {
  name: string;
  number: string;
  codeValue: string;
  format: FormatId;
  /** Raw Catima type when it is one we do not render (MAXICODE, RSS_14, …) → the card is stored as `none` with this in the note. */
  unknownType: string | null;
  color: string | null;
  note: string;
  balance: string;
  balanceCurrency: string;
  validFrom: number | null;
  expiry: number | null;
};

function isCatimaShareUrl(u: URL): boolean {
  return CATIMA_SHARE_HOSTS.some((h) => u.hostname === h.host && u.pathname === h.path);
}

function decodeParams(query: string, twice: boolean): Map<string, string> {
  const text = twice ? safeDecode(query) : query;
  const out = new Map<string, string>();
  for (const pair of text.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = safeDecode(eq < 0 ? pair : pair.slice(0, eq));
    const value = eq < 0 ? '' : safeDecode(pair.slice(eq + 1));
    out.set(key, value);
  }
  return out;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, '%20'));
  } catch {
    return s;
  }
}

const ms = (s: string | undefined): number | null => (s && /^-?\d+$/.test(s) ? Number(s) : null);

/** Parses both forms; null when the URL is not a Catima share link or has no card id or no store name. */
export function parseCatimaShareUrl(text: string): SharedCard | null {
  let u: URL;
  try {
    u = new URL(text.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!isCatimaShareUrl(u)) return null;
  const params = u.hash.length > 1 ? decodeParams(u.hash.slice(1), true) : u.search.length > 1 ? decodeParams(u.search.slice(1), false) : null;
  if (!params) return null;
  const number = params.get('cardid') ?? '';
  if (number === '') return null;
  // Catima requires a store (CatimaImporter L402); a link without one is refused, never an empty-name card (B2 CL-16).
  // An over-long store name is cut to 80 characters like the zip reader does (D37).
  const name = cleanName(params.get('store') ?? '');
  if (name === '') return null;
  const type = params.get('barcodetype')?.trim() ?? '';
  const format = type ? formatFromCatima(type) : 'none';
  const codeValue = params.get('barcodeid') ?? '';
  // an unknown-to-us type → number only with "Catima type: X" in the note, the same rule as the zip reader (D33 Q4)
  const baseNote = params.get('note') ?? '';
  const typeNote = type && !format ? (baseNote === '' ? `Catima type: ${type.toUpperCase()}` : `${baseNote}\nCatima type: ${type.toUpperCase()}`) : baseNote;
  const unit = currencyKeepingNote(params.get('balancetype') ?? '', typeNote);
  const code = checkImportedCode({ number, codeValue: codeValue === number ? '' : codeValue, format: format ?? 'none', note: unit.note });
  return {
    name,
    number,
    codeValue,
    format: code.format,
    unknownType: type && !format ? type.toUpperCase() : null,
    color: catimaColorToHex(params.get('headercolor')),
    note: code.note,
    balance: cleanBalance(params.get('balance') ?? ''),
    balanceCurrency: unit.currency,
    validFrom: ms(params.get('validfrom')),
    expiry: ms(params.get('expiry')),
  };
}

/**
 * The 2.0 form (fragment, double-encoded) on catima.app. null for a card without a number: Catima requires `cardid`
 * (review M5). Only an ISO 4217 balance type is written; the balance with a '.' decimal point (Java BigDecimal).
 */
export function buildCatimaShareUrl(card: Omit<SharedCard, 'unknownType'> & { unknownType?: string | null }): string | null {
  if (card.number.trim() === '') return null;
  const pairs: [string, string][] = [
    ['store', card.name],
    ['note', card.note],
  ];
  if (card.validFrom !== null) pairs.push(['validfrom', String(card.validFrom)]);
  if (card.expiry !== null) pairs.push(['expiry', String(card.expiry)]);
  const balance = catimaBalance(card.balance);
  if (card.balance !== '' && balance.ok) pairs.push(['balance', balance.value]);
  if (card.balanceCurrency !== '' && isCurrencyCode(card.balanceCurrency)) pairs.push(['balancetype', card.balanceCurrency]);
  pairs.push(['cardid', card.number]);
  if (card.codeValue !== '' && card.codeValue !== card.number) pairs.push(['barcodeid', card.codeValue]);
  const catimaType = FORMATS[card.format].catima;
  if (catimaType) pairs.push(['barcodetype', catimaType]);
  if (card.color) pairs.push(['headercolor', String(hexToCatimaColor(card.color))]);
  const inner = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return `https://catima.app/share#${encodeURIComponent(inner)}`;
}

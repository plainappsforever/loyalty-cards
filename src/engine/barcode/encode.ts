// The one place that calls bwip-js (MIT; BWIPP by Terry Burton, D28): encoder text/options per format and the raw
// module output. validate.ts uses it to check 2D capacity by a trial encode (D32), render.ts to build the Matrix.
// A small cache keeps "validate, then render" of the same long value to ONE encode.
import bwipjs from 'bwip-js/generic';

import { splitCodabar } from './codabar';
import { FORMATS, type FormatId } from './formats';

export type Raw1D = { sbs: number[]; bhs: number[]; bbs: number[] };
export type Raw2D = { pixs: number[]; pixx: number; pixy: number };

const NON_ASCII = /[^\x00-\x7f]/;
/** Aztec/PDF417/Data Matrix carry non-ASCII text as UTF-8 behind an ECI 26 header (D31); QR stays plain UTF-8. */
const ECI_FORMATS: readonly FormatId[] = ['aztec', 'pdf417', 'datamatrix'];

/**
 * The text bwip-js gets for a value: Codabar needs start/stop letters (A…B added when the user typed none); a 2D value
 * with non-ASCII characters gets the `^ECI000026` prefix and literal carets doubled (`^^`) for bwipp's parsefnc (D31).
 */
export function encoderText(value: string, format: FormatId): string {
  if (format === 'codabar') {
    const { start, body } = splitCodabar(value);
    return start ? value : `A${body}B`;
  }
  if (ECI_FORMATS.includes(format) && NON_ASCII.test(value)) return `^ECI000026${value.replace(/\^/g, '^^')}`;
  return value;
}

/**
 * Aztec error correction in percent (D46): 33 instead of bwipp's default 23. B3 found the heaviest Aztec (1,480 UTF-8
 * bytes) unread by Vision at the dim-contrast level at 2–3 px, and at 5 px too in the fix-round probe: a larger module
 * did not cure it, more error correction plus a 4-module quiet zone did (every probe value read at 3–8 px, both
 * contrasts). Up to AZTEC_EC_MAX_BYTES (the smallest 33 % capacity measured, a punctuation mix) the 33 % symbol is
 * tried first; a value it cannot hold falls back to 23 %, so the capacity (D32) is exactly what it was.
 */
export const AZTEC_EC_PERCENT = 33;
export const AZTEC_EC_MAX_BYTES = 1600;

export function encoderOptions(value: string, format: FormatId): Record<string, unknown> {
  const eci = ECI_FORMATS.includes(format) && NON_ASCII.test(value) ? { parsefnc: true } : {}; // never `parse`: it runs first and would re-expose escaped carets
  switch (format) {
    case 'qr':
      return { eclevel: 'M' };
    case 'pdf417':
      return { columns: 0, ...eci };
    case 'aztec':
      return utf8Bytes(value).total <= AZTEC_EC_MAX_BYTES ? { ...eci, eclevel: AZTEC_EC_PERCENT } : eci;
    case 'datamatrix':
      return eci;
    case 'code128':
      return { parse: false, parsefnc: false };
    case 'code93':
      return { includecheck: true }; // the two check characters are mandatory in Code 93; readers reject a symbol without them
    default:
      return {};
  }
}

function raw(bwip: string, text: string, options: Record<string, unknown>): Raw1D | Raw2D | undefined {
  // The named export `raw` is the "raw" symbology encoder; the default export's `raw` is ToRaw (the matrix function).
  // eslint-disable-next-line import/no-named-as-default-member
  return (bwipjs.raw(bwip, text, options) as (Raw1D | Raw2D)[])[0];
}

const CACHE_SIZE = 8;
const cache = new Map<string, Raw1D | Raw2D>();

/** bwip-js raw output for an already validated value. Throws what bwip-js throws. */
export function encodeRaw(value: string, format: FormatId): Raw1D | Raw2D {
  const bwip = FORMATS[format].bwip;
  if (!bwip) throw new Error(`format ${format} has no barcode`);
  const key = `${format}\u0000${value}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const text = encoderText(value, format);
  const options = encoderOptions(value, format);
  let first: Raw1D | Raw2D | undefined;
  try {
    first = raw(bwip, text, options);
  } catch (e) {
    // D46: a value the 33 % Aztec cannot hold gets bwipp's default level, never a refusal it did not have before
    if (options.eclevel === undefined || format !== 'aztec') throw e;
    const { eclevel: _ec, ...fallback } = options;
    first = raw(bwip, text, fallback);
  }
  if (!first) throw new Error(`bwip-js returned nothing for ${format}`);
  cache.set(key, first);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  return first;
}

/** For timing measurements (A3): the next encode is a real one. */
export function clearEncodeCache(): void {
  cache.clear();
}

/**
 * UTF-8 byte counts below which EVERY value fits the symbol with our options, so no trial encode is needed (D32):
 * half of the smallest failing size measured by fuzzing mixed content (P4c: PDF417 994 B — pure ASCII mixes —,
 * Data Matrix 1,552 B, Aztec 1,903 B, QR 2,328 B). Above them, `fitsSymbol` asks bwip-js.
 */
export const TRIAL_FREE_BYTES: Readonly<Partial<Record<FormatId, number>>> = { qr: 1150, aztec: 950, pdf417: 480, datamatrix: 750 };

/**
 * Byte-mode capacity of the largest symbol (standards: QR 40-M 2,331; Aztec 32 layers 1,914; PDF417 925 data codewords
 * = 1,110 bytes; Data Matrix 144×144 1,558 codewords). Characters ≥ U+0080 can only travel as UTF-8 bytes in byte mode,
 * so more non-ASCII bytes than this can never fit — refused without a (slow, failing) trial encode.
 */
export const MAX_BYTE_MODE: Readonly<Partial<Record<FormatId, number>>> = { qr: 2331, aztec: 1914, pdf417: 1110, datamatrix: 1558 };

function utf8Bytes(s: string): { total: number; nonAscii: number } {
  let total = 0;
  let nonAscii = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    total += n;
    if (n > 1) nonAscii += n;
  }
  return { total, nonAscii };
}

/** True when the 2D symbol can hold the value at the largest size bwip-js offers with our options (byte capacity, D32). */
export function fitsSymbol(value: string, format: FormatId): boolean {
  const { total, nonAscii } = utf8Bytes(value);
  if (total <= (TRIAL_FREE_BYTES[format] ?? 0)) return true;
  if (nonAscii > (MAX_BYTE_MODE[format] ?? Infinity)) return false;
  try {
    encodeRaw(value, format);
    return true;
  } catch {
    return false;
  }
}

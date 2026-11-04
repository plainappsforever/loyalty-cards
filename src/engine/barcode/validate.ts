// Code validation and format suggestion (SPEC §5.1). Pure, float-free. A value is never changed silently: `validate`
// says what is wrong and may offer ONE suggestion the user has to tap (L26); `normalise` only trims, upper-cases
// where the symbology has no lower case (Code 39/93, Codabar) and strips spaces/hyphens from digit-only formats.
// GS1 check digit and UPC-E expansion: check-digit.ts (Price Book copy). Independent oracle: referee/python/validate_oracle.py (A1).
import { expandUpcE, gs1CheckDigit, gs1Checks } from './check-digit';
import { splitCodabar } from './codabar';
import { fitsSymbol } from './encode';
import { FORMAT_IDS, FORMATS, formatFromHint, type FormatId } from './formats';

export { splitCodabar } from './codabar';

export type ValidationError =
  | 'empty' // nothing typed
  | 'chars' // a character the symbology cannot encode
  | 'length' // wrong number of characters/digits
  | 'checkDigit' // last digit is not the GS1 check digit
  | 'numberSystem' // UPC-E must start with 0 or 1
  | 'startStop' // Codabar start/stop letters: both or none, A–D
  | 'tooLong' // more characters than the format allows (2D: more than 1,000)
  | 'capacity'; // 2D: within 1,000 characters but more bytes than the largest symbol holds (D32, D33 Q8)

export type SuggestionReason = 'addCheckDigit' | 'fixCheckDigit' | 'addLeadingZero' | 'addNumberSystem';

export type Validation =
  | { ok: true; value: string; notes: ('upperCased' | 'separatorsRemoved')[] }
  | { ok: false; error: ValidationError; suggestion?: { value: string; reason: SuggestionReason; detail: string } };

const DIGIT_FORMATS: readonly FormatId[] = ['ean13', 'ean8', 'upca', 'upce', 'itf'];
const UPPER_FORMATS: readonly FormatId[] = ['code39', 'code93', 'codabar'];
/** Codabar data characters between start and stop: at least 2 (D30). */
export const CODABAR_MIN_BODY = 2;

/** Canonical string for a format: trim; digits only (spaces/hyphens/dots removed) for EAN/UPC/ITF; upper case for 39/93/Codabar. */
export function normalise(raw: string, format: FormatId): { value: string; notes: ('upperCased' | 'separatorsRemoved')[] } {
  const notes: ('upperCased' | 'separatorsRemoved')[] = [];
  let value = String(raw ?? '');
  if (format === 'qr' || format === 'aztec' || format === 'pdf417' || format === 'datamatrix') return { value: value.replace(/^\s+|\s+$/g, ''), notes };
  value = value.trim();
  if (DIGIT_FORMATS.includes(format)) {
    const stripped = value.replace(/[    -]/g, '');  // spaces and hyphens only; '.' is a charset error (D33 Q6)
    if (stripped !== value) notes.push('separatorsRemoved');
    value = stripped;
  }
  if (UPPER_FORMATS.includes(format)) {
    // ASCII a–z only: 'ß'.toUpperCase() = 'SS', 'ı' → 'I', 'ﬁ' → 'FI' would change the value silently (B1 N2)
    const upper = value.replace(/[a-z]+/g, (m) => m.toUpperCase());
    if (upper !== value) notes.push('upperCased');
    value = upper;
  }
  return { value, notes };
}

/** The GS1 formats: fixed digit count; one digit short → the check digit is offered; wrong check → the right one is offered. */
function validateGs1(value: string, length: number): Validation {
  if (!/^[0-9]+$/.test(value)) return { ok: false, error: 'chars' };
  if (value.length === length - 1) {
    const check = gs1CheckDigit(value);
    return { ok: false, error: 'length', suggestion: { value: value + check, reason: 'addCheckDigit', detail: check } };
  }
  if (value.length !== length) return { ok: false, error: 'length' };
  if (!gs1Checks(value)) {
    const check = gs1CheckDigit(value.slice(0, -1));
    return { ok: false, error: 'checkDigit', suggestion: { value: value.slice(0, -1) + check, reason: 'fixCheckDigit', detail: check } };
  }
  return { ok: true, value, notes: [] };
}

function validateUpcE(value: string): Validation {
  if (!/^[0-9]+$/.test(value)) return { ok: false, error: 'chars' };
  if (value.length === 6) {
    const check = gs1CheckDigit(expandUpcE(`0${value}0`).slice(0, 11));
    return { ok: false, error: 'length', suggestion: { value: `0${value}${check}`, reason: 'addNumberSystem', detail: `0…${check}` } };
  }
  if (value.length === 7) {
    if (value[0] !== '0' && value[0] !== '1') return { ok: false, error: 'numberSystem' };
    const check = gs1CheckDigit(expandUpcE(`${value}0`).slice(0, 11));
    return { ok: false, error: 'length', suggestion: { value: value + check, reason: 'addCheckDigit', detail: check } };
  }
  if (value.length !== 8) return { ok: false, error: 'length' };
  if (value[0] !== '0' && value[0] !== '1') return { ok: false, error: 'numberSystem' };
  const expanded = expandUpcE(value);
  if (!gs1Checks(expanded)) {
    const check = gs1CheckDigit(expanded.slice(0, 11));
    return { ok: false, error: 'checkDigit', suggestion: { value: value.slice(0, 7) + check, reason: 'fixCheckDigit', detail: check } };
  }
  return { ok: true, value, notes: [] };
}

/** Validates `raw` for `format`; the returned value is the canonical one (normalised), never auto-corrected. */
export function validate(raw: string, format: FormatId): Validation {
  const { value, notes } = normalise(raw, format);
  const info = FORMATS[format];
  if (value.length === 0) return format === 'none' ? { ok: true, value, notes } : { ok: false, error: 'empty' };
  switch (format) {
    case 'none':
      // number only: at most 200 characters, counted as code points (D36)
      return [...value].length > info.maxLength ? { ok: false, error: 'tooLong' } : { ok: true, value, notes };
    case 'ean13':
      return withNotes(validateGs1(value, 13), notes);
    case 'ean8':
      return withNotes(validateGs1(value, 8), notes);
    case 'upca':
      return withNotes(validateGs1(value, 12), notes);
    case 'upce':
      return withNotes(validateUpcE(value), notes);
    case 'itf': {
      if (!/^[0-9]+$/.test(value)) return { ok: false, error: 'chars' };
      if (value.length > info.maxLength) return { ok: false, error: 'tooLong' };
      if (value.length % 2 === 1) return { ok: false, error: 'length', suggestion: { value: `0${value}`, reason: 'addLeadingZero', detail: '0' } };
      if (value.length < info.minLength) return { ok: false, error: 'length' };
      return { ok: true, value, notes };
    }
    case 'codabar': {
      const { start, stop, body } = splitCodabar(value);
      if ((start === null) !== (stop === null)) return { ok: false, error: 'startStop' };
      if (body.length === 0) return { ok: false, error: 'length' }; // "AB": start/stop without data (D33 Q7)
      if (!/^[0-9$:/.+-]+$/.test(body)) return { ok: false, error: 'chars' };
      if (body.length < CODABAR_MIN_BODY) return { ok: false, error: 'length' }; // readers (Vision, dev run 2026-10-16) do not decode a 1-character body (D30)
      if (value.length > info.maxLength) return { ok: false, error: 'tooLong' };
      return { ok: true, value, notes };
    }
    case 'code39':
    case 'code93':
    case 'code128': {
      if (!info.charset!.test(value)) return { ok: false, error: 'chars' };
      if (value.length > info.maxLength) return { ok: false, error: 'tooLong' };
      return { ok: true, value, notes };
    }
    case 'qr':
    case 'aztec':
    case 'pdf417':
    case 'datamatrix':
      // ≤ 1,000 characters AND within the symbol's byte capacity for our encoding (UTF-8, ECI 26 for non-ASCII
      // Aztec/PDF417/Data Matrix), checked by a trial encode above a safe byte count (D32, review M3)
      if ([...value].length > info.maxLength) return { ok: false, error: 'tooLong' };
      if (!fitsSymbol(value, format)) return { ok: false, error: 'capacity' };
      return { ok: true, value, notes };
  }
}

function withNotes(v: Validation, notes: ('upperCased' | 'separatorsRemoved')[]): Validation {
  return v.ok ? { ...v, notes } : v;
}

export type FormatSuggestion = {
  format: FormatId;
  /** Why this format fits (shown as one line; the UI translates the reason codes). */
  reason: 'scanner' | 'digitsCheckOk' | 'digitsCheckShown' | 'twin' | 'evenDigits' | 'printableAscii' | 'charsetOk' | 'anyText' | 'odd';
  /** The value the format would store (e.g. with the check digit appended for 'digitsCheckShown'). */
  value: string;
};

/**
 * Ranked formats for a typed or scanned value (SPEC §5.1, D33 Q3): the scanner's reported type first (when the value is
 * valid for it), then the exact-length GS1 readings (12 digits: UPC-A before EAN-13), twins (8 digits = EAN-8 or UPC-E),
 * GS1 readings with a check digit SHOWN, Code 128, ITF, Code 39, Code 93, Codabar, QR, Aztec, PDF417, Data Matrix —
 * every format the value satisfies. Never empty: 'none' when nothing fits.
 */
export function suggestFormats(raw: string, scannerHint?: string | null): FormatSuggestion[] {
  const out: FormatSuggestion[] = [];
  const seen = new Set<FormatId>();
  const push = (format: FormatId, reason: FormatSuggestion['reason'], value: string) => {
    if (seen.has(format)) return;
    seen.add(format);
    out.push({ format, reason, value });
  };
  const hinted = formatFromHint(scannerHint);
  if (hinted && hinted !== 'none') {
    const v = validate(raw, hinted);
    if (v.ok) push(hinted, 'scanner', v.value);
  }
  const digits = normalise(raw, 'ean13').value;
  const allDigits = /^[0-9]+$/.test(digits) && digits.length > 0;
  if (allDigits) {
    const gs1: [FormatId, number][] = [
      ['ean13', 13],
      ['upca', 12],
      ['ean8', 8],
    ];
    // exact-length readings whose check holds come first, then the ones with a check digit SHOWN (a different
    // number the user must accept): 12 digits → UPC-A, then EAN-13 with an appended check (SPEC §5.1, review M6)
    for (const [f, len] of gs1) {
      if (digits.length !== len) continue;
      const v = validate(digits, f);
      if (v.ok) push(f, f === 'ean8' && seen.has('upce') ? 'twin' : 'digitsCheckOk', v.value);
    }
    if (digits.length === 8) {
      const v = validate(digits, 'upce');
      if (v.ok) push('upce', seen.has('ean8') ? 'twin' : 'digitsCheckOk', v.value);
    }
    for (const [f, len] of gs1) {
      if (digits.length !== len - 1) continue;
      const v = validate(digits, f);
      if (!v.ok && v.suggestion) push(f, 'digitsCheckShown', v.suggestion.value);
    }
  }
  const c128 = validate(raw, 'code128');
  if (c128.ok) push('code128', 'printableAscii', c128.value);
  if (allDigits) {
    const itf = validate(digits, 'itf');
    if (itf.ok) push('itf', 'evenDigits', itf.value);
  }
  // every other format the value satisfies (D33 Q3): Code 39/93 and Codabar after the numeric ones, then the 2D codes
  for (const f of ['code39', 'code93', 'codabar'] as const) {
    const v = validate(raw, f);
    if (v.ok) push(f, 'charsetOk', v.value);
  }
  for (const f of ['qr', 'aztec', 'pdf417', 'datamatrix'] as const) {
    const v = validate(raw, f);
    if (v.ok) push(f, 'anyText', v.value);
  }
  if (out.length === 0) push('none', 'anyText', String(raw ?? '').trim());
  return out;
}

/** Every format id the value is valid for (used by import to pick a format from a loose type name). */
export function validFormatsFor(raw: string): FormatId[] {
  return FORMAT_IDS.filter((f) => f !== 'none' && validate(raw, f).ok);
}

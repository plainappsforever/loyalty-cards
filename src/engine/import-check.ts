// One rule for every importer (review M1; SPEC §2 "never silently renders a code that no scanner would accept"):
// the barcode value (code value, else the number) must pass validate() for the stored format. If it does not, the
// card is kept as "number only" (format none) with the number untouched and the reason — plus the fix validate()
// offers — written into the note, so the user sees it and can pick the format in Edit. Nothing is completed, padded
// or re-encoded. A value the format can hold only in capitals (Code 39/93, Codabar) is drawn in capitals and the
// note says so (SPEC §5.1 "upper-cased with a visible note").
import { FORMATS, type FormatId } from './barcode/formats';
import { validate, type ValidationError } from './barcode/validate';

const REASON: Record<ValidationError, string> = {
  empty: 'no barcode value',
  chars: 'it contains characters this barcode cannot hold',
  length: 'wrong number of characters',
  checkDigit: 'the check digit does not match',
  numberSystem: 'UPC-E must start with 0 or 1',
  startStop: 'Codabar start and stop letters must both be there or both be missing',
  tooLong: 'too long for this barcode',
  capacity: 'more data than the largest symbol of this barcode holds',
};

export type CodeCheck = { format: FormatId; note: string; invalid: boolean };

const addLine = (note: string, line: string): string => (note === '' ? line : `${note}\n${line}`);

/** Checks an imported card's barcode; returns the format to store, the note (with the reason added) and whether it was demoted. */
export function checkImportedCode(card: { number: string; codeValue: string; format: FormatId; note: string }): CodeCheck {
  if (card.format === 'none') return { format: 'none', note: card.note, invalid: false };
  const value = card.codeValue !== '' ? card.codeValue : card.number;
  const v = validate(value, card.format);
  const name = FORMATS[card.format].name;
  if (v.ok) {
    if (v.notes.includes('upperCased')) return { format: card.format, note: addLine(card.note, `${name} has no lower case: the barcode shows ${v.value}`), invalid: false };
    return { format: card.format, note: card.note, invalid: false };
  }
  const fix = v.suggestion ? ` (suggested: ${v.suggestion.value})` : '';
  return { format: 'none', note: addLine(card.note, `${name} barcode not drawn: ${REASON[v.error]}${fix}. Edit the card to choose a barcode type.`), invalid: true };
}

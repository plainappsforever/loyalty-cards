// GS1 check digit and UPC-E expansion. Copied from Price Book `src/engine/barcode.ts` (same portfolio, 2026-10-16)
// with the same digit arithmetic (no Number(): float-free engine). validate.ts (P2) builds the format rules on top.

/** GS1 mod 10: weights 3, 1, 3, 1 ... from the rightmost data digit. */
export function gs1CheckDigit(data: string): string {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const digit = data.charCodeAt(data.length - 1 - i) - 48;
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return String((10 - (sum % 10)) % 10);
}

/** True when the last digit is the GS1 check digit of the digits before it. */
export function gs1Checks(code: string): boolean {
  return code.length >= 2 && gs1CheckDigit(code.slice(0, -1)) === code.slice(-1);
}

/** UPC-E (number system, six digits, check) -> the 12-digit UPC-A it stands for (same check digit). */
export function expandUpcE(code8: string): string {
  const ns = code8[0];
  const [d1, d2, d3, d4, d5, d6] = code8.slice(1, 7);
  const check = code8[7];
  let body: string;
  if (d6 === '0' || d6 === '1' || d6 === '2') body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === '3') body = `${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === '4') body = `${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return `${ns}${body}${check}`;
}

// Catima `headercolor` = Android colour int (signed 32-bit ARGB, e.g. -9977996) ↔ our `#rrggbb` (D17). Alpha is dropped on
// read and written as ff. Catima leaves the value empty when the card has no colour.
export function catimaColorToHex(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < -2147483648 || n > 4294967295) return null;
  const rgb = (n >>> 0) & 0xffffff;
  return `#${rgb.toString(16).padStart(6, '0')}`;
}

export function hexToCatimaColor(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  return (0xff000000 | parseInt(m[1], 16)) | 0; // signed, as Android's Color int
}

/** A deterministic, readable colour for a card without one (same name → same colour). */
export function colorForName(name: string): string {
  const palette = ['#1f6f43', '#6b2fa0', '#c0392b', '#2c3e50', '#16a085', '#e67e22', '#2980b9', '#8e44ad', '#27ae60', '#d35400', '#34495e', '#7f8c8d'];
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return palette[h % palette.length];
}

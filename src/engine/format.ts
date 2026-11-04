// Display formatting (SPEC §5.7): balance with the locale number format + currency code (never converted), expiry as a
// locale date with "expires in n days"/"expired" states (≤ 30 days = warning), number grouping for display only.
export type ExpiryState = 'none' | 'ok' | 'soon' | 'expired';
export const EXPIRY_WARN_DAYS = 30;
const DAY = 86_400_000;

export function formatBalance(balance: string, currency: string, locale = 'en'): string {
  if (balance === '') return '';
  const n = Number(balance);
  const text = Number.isFinite(n) ? new Intl.NumberFormat(locale, { minimumFractionDigits: balance.includes('.') ? Math.min(balance.split('.')[1].length, 4) : 0, maximumFractionDigits: 4 }).format(n) : balance;
  return currency === '' ? text : `${text} ${currency}`;
}

export function expiryState(expiry: number | null, now: number): { state: ExpiryState; days: number | null } {
  if (expiry === null) return { state: 'none', days: null };
  const days = Math.ceil((expiry - now) / DAY);
  if (days < 0) return { state: 'expired', days };
  return { state: days <= EXPIRY_WARN_DAYS ? 'soon' : 'ok', days };
}

export function formatDate(ms: number | null, locale = 'en'): string {
  return ms === null ? '' : new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(ms));
}

/** Groups of 4 from the left for ≥ 10 digit-only values ("1234 5678 9012 3"); anything else unchanged. Copy copies the raw value. */
export function groupNumber(value: string): string {
  if (!/^\d{10,}$/.test(value)) return value;
  return value.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** Up to two initials for the tile ("Kaffeehaus Lila" → "KL", "dm" → "DM"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length >= 2 ? [words[0], words[words.length - 1]].map((w) => [...w][0]) : [...words[0] ?? ''].slice(0, 2);
  return letters.join('').toUpperCase();
}

/** Black or white text for a #rrggbb background (WCAG-style relative luminance). */
export function textColorOn(hex: string): '#000000' | '#ffffff' {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.4 ? '#000000' : '#ffffff';
}

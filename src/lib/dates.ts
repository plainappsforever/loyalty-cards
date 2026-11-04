// Calendar dates (expiry, valid from) — review S8, decided in P6 (D43): a date the user types or a CSV carries is a
// CALENDAR day, stored as Unix ms at UTC midnight (the engine's `dateMs`, same as the CSV reader/writer). Display: a
// value at exactly UTC midnight is shown as that UTC calendar day (so "2027-12-31" reads 31 Dec 2027 in Berlin and in
// New York); any other instant (Catima stores local midnight of the exporting phone) is shown in the device's zone,
// which is the day the exporting user picked when both phones share a zone.
import { dateMs, isoDate } from '@/engine/csv';

export { dateMs as parseDay };

const DAY = 86_400_000;

export function formatDay(ms: number | null, locale = 'en'): string {
  if (ms === null) return '';
  const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
  if (ms % DAY === 0) opts.timeZone = 'UTC';
  try {
    return new Intl.DateTimeFormat(locale, opts).format(new Date(ms));
  } catch {
    return isoDate(ms);
  }
}

/** The YYYY-MM-DD text for the Edit field (same rule as formatDay). */
export function dayText(ms: number | null): string {
  if (ms === null) return '';
  if (ms % DAY === 0) return isoDate(ms);
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

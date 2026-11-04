/**
 * @jest-environment node
 */
import { dayText, formatDay, parseDay } from './dates';

describe('calendar dates (S8, D43)', () => {
  it('a typed day is stored at UTC midnight and shown as that day in every zone', () => {
    const ms = parseDay('2027-12-31')!;
    expect(ms).toBe(Date.UTC(2027, 11, 31));
    expect(formatDay(ms, 'en')).toBe('Dec 31, 2027');
    expect(dayText(ms)).toBe('2027-12-31');
    expect(parseDay('31.12.2027')).toBeNull();
    expect(formatDay(null)).toBe('');
  });

  it('another instant (Catima local midnight) is shown in the device zone', () => {
    const local = new Date(2027, 11, 31).getTime();
    if (local % 86_400_000 !== 0) expect(dayText(local)).toBe('2027-12-31');
  });
});

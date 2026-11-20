// Deterministic seed sets for the dev route <scheme>://debug/seed?set=<name> and the tests (SPEC §7.11, A9/A17 timing).
// Fictional chain names only (D16). Pure: no React Native, no database.
import { gs1CheckDigit } from '@/engine/barcode/check-digit';
import type { FormatId } from '@/engine/barcode/formats';
import type { NewCard } from '@/db/cards';

export const SEED_SETS = ['empty', 'ten', 'two-hundred', 'five-hundred', 'store-demo'] as const;
export type SeedSet = (typeof SEED_SETS)[number];

const CHAINS: { name: string; color: string; format: FormatId }[] = [
  { name: 'Nordmarkt', color: '#1f6f43', format: 'ean13' },
  { name: 'Kaffeehaus Lila', color: '#6b2fa0', format: 'qr' },
  { name: 'Drogerie Sonne', color: '#e0a100', format: 'code128' },
  { name: 'Bauhof Plus', color: '#c0392b', format: 'itf' },
  { name: 'Bücherecke', color: '#2c3e50', format: 'code39' },
  { name: 'Fjordapotheke', color: '#1abc9c', format: 'ean8' },
  { name: 'Velo Depot', color: '#e67e22', format: 'codabar' },
  { name: 'Grünwald Tankstelle', color: '#27ae60', format: 'upca' },
  { name: 'Casa Pasta', color: '#8e44ad', format: 'aztec' },
  { name: 'Hafenkino', color: '#34495e', format: 'pdf417' },
  { name: 'Mondschein Bar', color: '#d35400', format: 'datamatrix' },
  { name: 'Pixelpark', color: '#2980b9', format: 'code93' },
  { name: 'Tante Emmas Laden', color: '#7f8c8d', format: 'none' },
  { name: 'Alpenblick Sport', color: '#16a085', format: 'upce' },
];

/** Small deterministic PRNG (mulberry32) so a seed set is the same on every run. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const digits = (rand: () => number, n: number) => Array.from({ length: n }, () => String(Math.floor(rand() * 10))).join('');

/** A valid value for the format (check digits computed; UPC-E number system 0). */
export function seedValue(format: FormatId, rand: () => number): string {
  switch (format) {
    case 'ean13': {
      const d = digits(rand, 12);
      return d + gs1CheckDigit(d);
    }
    case 'ean8': {
      const d = digits(rand, 7);
      return d + gs1CheckDigit(d);
    }
    case 'upca': {
      const d = digits(rand, 11);
      return d + gs1CheckDigit(d);
    }
    case 'upce': {
      // 0 + 6 digits whose expansion (pattern d6 = 0..2 needs no care here: compute the check on the expanded UPC-A)
      const body = digits(rand, 6);
      const expanded = expand(`0${body}`);
      return `0${body}${gs1CheckDigit(expanded)}`;
    }
    case 'itf':
      return digits(rand, 10);
    case 'codabar':
      return `A${digits(rand, 8)}B`;
    case 'code39':
      return `LC${digits(rand, 7)}`;
    case 'code93':
      return `P${digits(rand, 8)}`;
    case 'code128':
      return `${digits(rand, 10)}`;
    case 'qr':
      return `CARD-${digits(rand, 12)}`;
    case 'aztec':
      return `AZ${digits(rand, 10)}`;
    case 'pdf417':
      return `PDF${digits(rand, 10)}`;
    case 'datamatrix':
      return `DM${digits(rand, 10)}`;
    case 'none':
      return digits(rand, 9);
  }
}

/** UPC-E (ns + 6 digits, no check) -> 11-digit UPC-A body for the check digit. */
function expand(code7: string): string {
  const ns = code7[0];
  const [d1, d2, d3, d4, d5, d6] = code7.slice(1, 7);
  let body: string;
  if (d6 === '0' || d6 === '1' || d6 === '2') body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === '3') body = `${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === '4') body = `${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return `${ns}${body}`;
}

export function seedCount(set: SeedSet): number {
  return set === 'empty' ? 0 : set === 'store-demo' ? STORE_DEMO.length : set === 'ten' ? 10 : set === 'two-hundred' ? 200 : 500;
}

/** Store screenshots (RELEASE_KIT 3f): fictional chains with realistic notes, varied colours, one favourite, nothing expired. */
const STORE_DEMO: { name: string; format: FormatId; number: string; color: string; note: string; noteDe: string; days: number | null; favourite?: boolean; balance?: string }[] = [
  { name: 'Nordmarkt', format: 'ean13', number: '4006381333931', color: '#1f6f43', note: 'Double points on Tuesdays', noteDe: 'Dienstags doppelte Punkte', days: null, favourite: true, balance: '12.50' },
  { name: 'Kaffeehaus Lila', format: 'qr', number: 'CARD-482916037254', color: '#6b2fa0', note: 'Every tenth coffee is free', noteDe: 'Jeder zehnte Kaffee gratis', days: null },
  { name: 'Drogerie Sonne', format: 'code128', number: '7390218465', color: '#e0a100', note: '', noteDe: '', days: null },
  { name: 'Bauhof Plus', format: 'itf', number: '5081927364', color: '#c0392b', note: 'Trade discount 5 %', noteDe: 'Handwerkerrabatt 5 %', days: 300 },
  { name: 'Bücherecke', format: 'code39', number: 'LC4820517', color: '#2c3e50', note: 'Member since 2023', noteDe: 'Mitglied seit 2023', days: null },
  { name: 'Fjordapotheke', format: 'ean8', number: '40063812', color: '#1abc9c', note: '', noteDe: '', days: null },
  { name: 'Velo Depot', format: 'codabar', number: 'A40916723B', color: '#e67e22', note: 'Free service after 5 stamps', noteDe: 'Gratis-Service nach 5 Stempeln', days: 150 },
  { name: 'Hafenkino', format: 'pdf417', number: 'PDF2049187365', color: '#34495e', note: 'Ten visits, the eleventh is free', noteDe: 'Zehn Besuche, der elfte ist gratis', days: 200 },
  { name: 'Casa Pasta', format: 'aztec', number: 'AZ5019283746', color: '#8e44ad', note: '', noteDe: '', days: null },
];

/** The cards of a seed set, ids `seed-<n>`, timestamps spread over the last 90 days before `now`. */
export function seedCards(set: SeedSet, now = 1_760_000_000_000, lang: 'en' | 'de' = 'en'): NewCard[] {
  if (set === 'store-demo') {
    const real = Date.now();
    return STORE_DEMO.map((c, i) => ({
      id: `seed-${i + 1}`,
      name: c.name,
      number: c.number,
      format: c.format,
      color: c.color,
      note: lang === 'de' ? c.noteDe : c.note,
      balance: c.balance ?? '',
      balanceCurrency: c.balance ? 'EUR' : '',
      expiry: c.days === null ? null : real + c.days * 86_400_000,
      favourite: c.favourite === true,
      archived: false,
      useCount: 9 - i,
      lastUsedAt: real - (i + 1) * 86_400_000,
    }));
  }
  const rand = prng(set.length * 7919 + 17);
  const n = seedCount(set);
  const cards: NewCard[] = [];
  for (let i = 0; i < n; i++) {
    const chain = CHAINS[i % CHAINS.length];
    const suffix = i >= CHAINS.length ? ` ${Math.floor(i / CHAINS.length) + 1}` : '';
    const value = seedValue(chain.format, rand);
    const useCount = Math.floor(rand() * 40);
    cards.push({
      id: `seed-${i + 1}`,
      name: `${chain.name}${suffix}`,
      number: value,
      format: chain.format,
      color: chain.color,
      note: i % 5 === 0 ? 'Seeded card\nsecond line' : '',
      balance: i % 7 === 0 ? '12.50' : '',
      balanceCurrency: i % 7 === 0 ? 'EUR' : '',
      expiry: i % 9 === 0 ? now + 20 * 86_400_000 : null,
      favourite: i % 6 === 0,
      archived: i % 25 === 24,
      useCount,
      lastUsedAt: useCount > 0 ? now - Math.floor(rand() * 90) * 86_400_000 : null,
    });
  }
  return cards;
}

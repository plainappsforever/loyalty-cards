// Curated chain list (D16, D25 Q1; SPEC §5.5): own work — names (nominative use), brand-like colours (not protected),
// the barcode format their loyalty cards TYPICALLY use (a hint the user can change; many chains moved to app QR codes),
// and a number-length hint where it is well known. No logos, no copied dataset. One file per country in chains/.
import type { FormatId } from './barcode/formats';
import { AT } from './chains/at';
import { BR } from './chains/br';
import { CH } from './chains/ch';
import { DE } from './chains/de';
import { ES } from './chains/es';
import { FR } from './chains/fr';
import { ID } from './chains/id';
import { IN } from './chains/in';
import { IT } from './chains/it';
import { JP } from './chains/jp';
import { KR } from './chains/kr';
import { MX } from './chains/mx';
import { NL } from './chains/nl';
import { PL } from './chains/pl';
import { PT } from './chains/pt';
import { RU } from './chains/ru';
import { TR } from './chains/tr';
import { UK } from './chains/uk';
import { US } from './chains/us';
import { VN } from './chains/vn';

export type Chain = {
  /** `<cc>-<slug>`, stable (stored in cards.chain_id). */
  id: string;
  name: string;
  aliases?: readonly string[];
  countries: readonly string[];
  color: string;
  format: FormatId;
  /** Typical number length when well known (shown as a hint, never enforced). */
  numberLength?: number;
};

export const CHAINS: readonly Chain[] = [...DE, ...AT, ...CH, ...UK, ...US, ...FR, ...IT, ...ES, ...NL, ...PL, ...PT, ...BR, ...TR, ...ID, ...IN, ...JP, ...KR, ...VN, ...RU, ...MX];

const byId = new Map(CHAINS.map((c) => [c.id, c]));

export function chainById(id: string | null | undefined): Chain | undefined {
  return id ? byId.get(id) : undefined;
}

/** Punctuation and spaces (ASCII, Latin-1, General Punctuation, CJK and full-width forms) — no \p{…} escapes (Hermes). */
const SEPARATORS = /[\s!-/:-@[-`{-~\u00a0-\u00bf\u2000-\u206f\u3000-\u303f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]+/g;

/**
 * Lower case, no Latin diacritics, no punctuation: "Müller" → "muller", "H&M" → "h m". Letters of every script are KEPT
 * (review S5: "Магнит", "ローソン", "이마트" used to fold to '' and matched everything as an empty query).
 */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(SEPARATORS, ' ')
    .trim();
}

/** ISO 3166 alpha-2 for the region; 'UK' (common, not ISO) means GB — the device region is GB (review S6). */
export function countryCode(country: string | null | undefined): string | null {
  if (!country) return null;
  const cc = country.trim().toUpperCase();
  return cc === 'UK' ? 'GB' : cc || null;
}

type Scored = { chain: Chain; score: number };

/**
 * Ranks chains for a typed query: name prefix > word prefix > alias prefix > substring; the user's country first, then
 * the chain's number of countries (international chains before local namesakes). Empty query → the country's chains.
 */
export function searchChains(query: string, country?: string | null, limit = 8): Chain[] {
  const q = fold(query);
  // a query of separators only ("&", "-") folds to nothing: it matches no chain (D36), unlike an empty query, which lists
  // the country's chains
  if (q === '' && query.trim() !== '') return [];
  const cc = countryCode(country);
  const scored: Scored[] = [];
  for (const chain of CHAINS) {
    let score = 0;
    if (q === '') score = cc && chain.countries.includes(cc) ? 1 : 0;
    else {
      const name = fold(chain.name);
      const aliases = (chain.aliases ?? []).map(fold);
      if (name.startsWith(q)) score = 100;
      else if (name.split(' ').some((w) => w.startsWith(q))) score = 80;
      else if (aliases.some((a) => a.startsWith(q) || a.split(' ').some((w) => w.startsWith(q)))) score = 60;
      else if (name.includes(q) || aliases.some((a) => a.includes(q))) score = 40;
    }
    if (score === 0) continue;
    if (cc && chain.countries.includes(cc)) score += 10;
    score += Math.min(chain.countries.length, 5);
    scored.push({ chain, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.chain.name.localeCompare(b.chain.name))
    .slice(0, limit)
    .map((s) => s.chain);
}

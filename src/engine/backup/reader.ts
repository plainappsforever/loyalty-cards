// Own backup import: every field is validated with the SPEC §4.2 CHECK rules; an invalid card is skipped with the
// reason (never "repaired" silently, L26); photos are attached by id. Never overwrites: the caller plans (import-plan.ts).
import { isFormatId } from '../barcode/formats';
import { cleanBalance, COLOR_RE, currencyKeepingNote, mergeCategories, type ImportedCard, type Skipped } from '../card-data';
import { isJpeg } from '../image-bytes';
import { checkImportedCode } from '../import-check';
import { isZip, readZip, utf8, zipEncryption } from '../zip';

import { BACKUP_APP, BACKUP_CARD_KEYS, BACKUP_FILE_KEYS, type BackupFile } from './writer';

export type BackupImport = {
  cards: (ImportedCard & { tile: 'initials' | 'photo'; chainId: string | null; useCount: number; sortIndex: number; createdAt: number; updatedAt: number })[];
  categories: string[];
  skipped: Skipped[];
  exportedAt: number | null;
  /** Cards whose number does not fit their barcode type: imported as number only, reason in the note (review M1). */
  invalidCodes: number;
  /** Photos that are not JPEG (or are cut short): the card is imported without that photo, the summary names it (D37). */
  brokenPhotos: { row: number; name: string; side: 'front' | 'back' }[];
};

export type BackupErrorCode = 'encrypted' | 'noJson' | 'notBackup' | 'version';

export class BackupFormatError extends Error {
  readonly code: BackupErrorCode;
  constructor(code: BackupErrorCode) {
    super(code);
    this.code = code; // plain field: the Node script loader (type stripping) cannot run parameter properties
  }
}

const NAME_MAX = 80;
const str = (v: unknown, max = 100000): string | null => (typeof v === 'string' && v.length <= max ? v : null);
const optMs = (v: unknown): number | null | undefined => (v === null ? null : Number.isSafeInteger(v) && (v as number) > 0 ? (v as number) : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : v === 0 || v === 1 ? v === 1 : undefined);
const count = (v: unknown): number | undefined => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : undefined);

/**
 * Validates one raw card object against docs/BACKUP_FORMAT.md; returns the card or the field that is wrong. Exactly the
 * writer's keys: an unknown or missing key skips the row with the key named — nothing is defaulted or dropped quietly
 * (B1 N5); a name over 80 characters is skipped, never cut (B1 N3; the CHECK rule counts characters, not UTF-16 units).
 */
export function checkBackupCard(raw: unknown): { card: BackupImport['cards'][number]; invalid: boolean } | { bad: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { bad: 'card' };
  const c = raw as Record<string, unknown>;
  const unknown = Object.keys(c).find((k) => !(BACKUP_CARD_KEYS as readonly string[]).includes(k));
  if (unknown !== undefined) return { bad: `unknown key ${unknown}` };
  const missing = BACKUP_CARD_KEYS.find((k) => !(k in c));
  if (missing !== undefined) return { bad: `missing key ${missing}` };
  if (str(c.id, 100) === null) return { bad: 'id' };
  const rawName = str(c.name);
  const name = rawName === null ? '' : rawName.replace(/\s+/g, ' ').trim();
  if (name === '' || [...name].length > NAME_MAX) return { bad: 'name' };
  const number = str(c.number);
  if (number === null) return { bad: 'number' };
  const codeValue = str(c.codeValue);
  if (codeValue === null) return { bad: 'codeValue' };
  if (!isFormatId(c.format)) return { bad: 'format' };
  if (typeof c.color !== 'string' || !COLOR_RE.test(c.color)) return { bad: 'color' };
  if (c.tile !== 'photo' && c.tile !== 'initials') return { bad: 'tile' };
  const note = str(c.note);
  if (note === null) return { bad: 'note' };
  const balance = str(c.balance);
  if (balance === null || (balance.trim() !== '' && cleanBalance(balance) === '' && !/^-?0+([.,]0+)?$/.test(balance.trim()))) return { bad: 'balance' };
  const currency = str(c.balanceCurrency);
  if (currency === null) return { bad: 'balanceCurrency' };
  const validFrom = optMs(c.validFrom);
  const expiry = optMs(c.expiry);
  const lastUsedAt = optMs(c.lastUsedAt);
  if (validFrom === undefined) return { bad: 'validFrom' };
  if (expiry === undefined) return { bad: 'expiry' };
  if (lastUsedAt === undefined) return { bad: 'lastUsedAt' };
  const favourite = bool(c.favourite);
  const archived = bool(c.archived);
  if (favourite === undefined) return { bad: 'favourite' };
  if (archived === undefined) return { bad: 'archived' };
  if (!Array.isArray(c.categories) || c.categories.some((g) => typeof g !== 'string' || g.trim() === '' || [...g.trim()].length > 40)) return { bad: 'categories' };
  const chainId = c.chainId === null ? null : str(c.chainId, 100);
  if (chainId === null && c.chainId !== null) return { bad: 'chainId' };
  const useCount = count(c.useCount);
  if (useCount === undefined) return { bad: 'useCount' };
  const sortIndex = count(c.sortIndex);
  if (sortIndex === undefined) return { bad: 'sortIndex' };
  const createdAt = optMs(c.createdAt);
  if (!createdAt) return { bad: 'createdAt' };
  const updatedAt = optMs(c.updatedAt);
  if (!updatedAt) return { bad: 'updatedAt' };
  const cleanCode = codeValue.trim() === number.trim() ? '' : codeValue.trim();
  const unit = currencyKeepingNote(currency, note);
  const code = checkImportedCode({ number: number.trim(), codeValue: cleanCode, format: c.format, note: unit.note });
  return {
    invalid: code.invalid,
    card: {
      name,
      number: number.trim(),
      codeValue: cleanCode,
      format: code.format,
      color: c.color,
      note: code.note,
      balance: cleanBalance(balance),
      balanceCurrency: unit.currency,
      validFrom,
      expiry,
      favourite,
      archived,
      lastUsedAt,
      categories: (c.categories as string[]).map((g) => g.trim()),
      images: {},
      tile: c.tile,
      chainId,
      useCount,
      sortIndex,
      createdAt,
      updatedAt,
    },
  };
}

export function readBackup(bytes: Uint8Array): BackupImport {
  let json: string;
  let files: Record<string, Uint8Array> = {};
  if (isZip(bytes)) {
    if (zipEncryption(bytes) === 'encrypted') throw new BackupFormatError('encrypted');
    files = readZip(bytes);
    const name = Object.keys(files).find((n) => n === 'backup.json' || n.endsWith('/backup.json'));
    if (!name) throw new BackupFormatError('noJson');
    json = utf8.decode(files[name]);
  } else json = utf8.decode(bytes);
  let file: Partial<BackupFile>;
  try {
    file = JSON.parse(json);
  } catch {
    throw new BackupFormatError('notBackup');
  }
  if (typeof file !== 'object' || file === null || !Array.isArray(file.cards)) throw new BackupFormatError('notBackup');
  // a key we do not know means this is not our format (or a newer one): refuse rather than drop it (B1 N5)
  if (Object.keys(file).some((k) => !(BACKUP_FILE_KEYS as readonly string[]).includes(k))) throw new BackupFormatError('notBackup');
  if (file.version !== BACKUP_VERSION_ACCEPTED) throw new BackupFormatError('version');
  // a backup says whose it is; another app's file (or one that does not say) is not ours (D37)
  if (file.app !== BACKUP_APP) throw new BackupFormatError('notBackup');
  const skipped: Skipped[] = [];
  const cards: BackupImport['cards'] = [];
  let invalidCodes = 0;
  const brokenPhotos: BackupImport['brokenPhotos'] = [];
  const cardsById = new Map<number, BackupImport['cards'][number]>();
  file.cards.forEach((raw, i) => {
    const r = checkBackupCard(raw);
    if ('bad' in r) {
      skipped.push({ row: i + 1, reason: 'badField', detail: r.bad });
      return;
    }
    const id = typeof (raw as { id?: unknown }).id === 'string' ? (raw as { id: string }).id : '';
    for (const side of ['front', 'back'] as const) {
      const bytes = files[`cards/${id}/${side}.jpg`];
      if (!bytes) continue;
      if (isJpeg(bytes)) r.card.images[side] = bytes;
      else brokenPhotos.push({ row: i + 1, name: r.card.name, side });
    }
    if (r.invalid) invalidCodes++;
    cardsById.set(i, r.card);
    cards.push(r.card);
  });
  if (file.categories !== undefined && (!Array.isArray(file.categories) || file.categories.some((g) => typeof g !== 'string'))) throw new BackupFormatError('notBackup');
  if (file.links !== undefined && (!Array.isArray(file.links) || file.links.some((l) => typeof l !== 'object' || l === null || typeof l.cardId !== 'string' || typeof l.category !== 'string'))) throw new BackupFormatError('notBackup');
  // links and per-card names say the same thing; a link the card list lacks is ADDED, never ignored
  const ids = file.cards.map((raw) => (typeof raw === 'object' && raw !== null && typeof (raw as { id?: unknown }).id === 'string' ? (raw as { id: string }).id : ''));
  for (const l of file.links ?? []) {
    const k = ids.indexOf(l.cardId);
    const card = k >= 0 ? cardsById.get(k) : undefined;
    if (card && l.category.trim() !== '' && !card.categories.includes(l.category.trim())) card.categories.push(l.category.trim());
  }
  const merged = mergeCategories([...(file.categories ?? []).filter((g) => g.trim() !== '').map((g) => g.trim()), ...cards.flatMap((c) => c.categories)], cards);
  const categories = merged;
  return { cards, categories, skipped, exportedAt: Number.isSafeInteger(file.exportedAt) ? (file.exportedAt as number) : null, invalidCodes, brokenPhotos };
}

const BACKUP_VERSION_ACCEPTED = 1;

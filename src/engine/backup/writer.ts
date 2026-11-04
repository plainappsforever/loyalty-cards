// Own backup zip (SPEC §5.4): `backup.json` {version:1, exportedAt, app, cards:[every column + categories], categories}
// + `cards/<id>/front.jpg|back.jpg` (photos ONLY as files, never inside the JSON). Keeps what Catima lacks (tile, chain,
// use count, sort order, photos as JPEG).
import type { CardData, CardImages } from '../card-data';
import { utf8, writeZip } from '../zip';

export const BACKUP_VERSION = 1;

export type BackupCard = CardData & {
  id: string;
  tile: 'initials' | 'photo';
  chainId: string | null;
  useCount: number;
  sortIndex: number;
  createdAt: number;
  updatedAt: number;
};

/** One card ↔ category link (redundant with `cards[].categories`, kept because SPEC §5.4 lists it; D33 Q2, B1 N4). */
export type BackupLink = { cardId: string; category: string };
export type BackupFile = { version: number; exportedAt: number; app: string; cards: BackupCard[]; categories: string[]; links: BackupLink[] };

/** The exact card keys of backup.json (docs/BACKUP_FORMAT.md, normative). The reader refuses others (B1 N5). */
export const BACKUP_CARD_KEYS = ['id', 'name', 'number', 'codeValue', 'format', 'color', 'note', 'balance', 'balanceCurrency', 'validFrom', 'expiry', 'favourite', 'archived', 'lastUsedAt', 'categories', 'tile', 'chainId', 'useCount', 'sortIndex', 'createdAt', 'updatedAt'] as const;
/** The `app` value every backup carries; the reader refuses any other (D37). */
export const BACKUP_APP = 'loyalty-cards';

export const BACKUP_FILE_KEYS = ['version', 'exportedAt', 'app', 'cards', 'categories', 'links'] as const;

/** Exactly the card columns — never `images` (review M4: a Uint8Array in JSON becomes {"0":255,…}, 19× its size). */
function columnsOnly(c: BackupCard): BackupCard {
  return {
    id: c.id,
    name: c.name,
    number: c.number,
    codeValue: c.codeValue,
    format: c.format,
    color: c.color,
    note: c.note,
    balance: c.balance,
    balanceCurrency: c.balanceCurrency,
    validFrom: c.validFrom,
    expiry: c.expiry,
    favourite: c.favourite,
    archived: c.archived,
    lastUsedAt: c.lastUsedAt,
    categories: [...c.categories],
    tile: c.tile,
    chainId: c.chainId,
    useCount: c.useCount,
    sortIndex: c.sortIndex,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export function backupJson(cards: readonly BackupCard[], categories: readonly string[], exportedAt: number, app = BACKUP_APP): string {
  const links = cards.flatMap((c) => c.categories.map((category) => ({ cardId: c.id, category })));
  const file: BackupFile = { version: BACKUP_VERSION, exportedAt, app, cards: cards.map(columnsOnly), categories: [...categories], links };
  return JSON.stringify(file, null, 1);
}

export function writeBackupZip(cards: readonly (BackupCard & { images?: CardImages })[], categories: readonly string[], exportedAt: number): Uint8Array {
  const entries: Record<string, Uint8Array> = { 'backup.json': utf8.encode(backupJson(cards, categories, exportedAt)) };
  for (const c of cards) {
    if (c.images?.front) entries[`cards/${c.id}/front.jpg`] = c.images.front;
    if (c.images?.back) entries[`cards/${c.id}/back.jpg`] = c.images.back;
  }
  return writeZip(entries);
}

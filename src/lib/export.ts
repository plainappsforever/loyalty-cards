// Export (U7) and "Send as file" (U6): builds the file bytes and an exact report before anything is shared (SPEC §2:
// "the file name and size are shown before sharing"). Catima zips carry only PNG images (D35, D37.6): our stored JPEG
// photos are converted through `photoAsPng` (native, code-kit transcodeImage); a photo that cannot be converted is left
// out and reported. Photos are read through injected functions, so this runs in Node tests.
import { listCards, type Card } from '@/db/cards';
import { listCategories } from '@/db/categories';
import type { Db } from '@/db/types';
import { writeBackupZip, type BackupCard } from '@/engine/backup/writer';
import type { CardData, CardImages } from '@/engine/card-data';
import { writeCatimaZip, type CatimaDropped, type CatimaOmitted } from '@/engine/catima/writer';
import { writeGenericCsv } from '@/engine/csv';
import { readZip, utf8 } from '@/engine/zip';

import type { PhotoSide } from './files';

export type ExportKind = 'catima' | 'backup' | 'csv';

export type ExportDeps = {
  /** The stored JPEG bytes of a card photo, null when missing. */
  readPhoto(cardId: string, side: PhotoSide): Promise<Uint8Array | null>;
  /** The photo converted to PNG bytes (Catima), null when missing; throws when the conversion fails. */
  photoAsPng(cardId: string, side: PhotoSide): Promise<Uint8Array | null>;
};

export type ExportResult = {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  exported: number;
  omitted: CatimaOmitted[];
  dropped: CatimaDropped[];
  /** Photos that could not be read or converted (left out of the file). */
  photoFailures: number;
  /** Photo files inside the file (Catima: PNG entries actually written). */
  photos: number;
};

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function exportFileName(kind: ExportKind, now: number): string {
  return kind === 'csv' ? `tillcard-cards-${day(now)}.csv` : `tillcard-${kind}-${day(now)}.zip`;
}

function toData(c: Card, names: Map<string, string>): CardData {
  return {
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
    categories: c.categoryIds.map((id) => names.get(id)).filter((n): n is string => !!n),
  };
}

async function images(c: Card, read: (id: string, side: PhotoSide) => Promise<Uint8Array | null>, fail: () => void): Promise<CardImages> {
  const out: CardImages = {};
  for (const side of ['front', 'back'] as const) {
    if (!(side === 'front' ? c.hasFront : c.hasBack)) continue;
    try {
      const bytes = await read(c.id, side);
      if (bytes) out[side] = bytes;
      else fail();
    } catch {
      fail();
    }
  }
  return out;
}

/** Every live card (archived included) — or only `onlyIds` (Send as file) — as the chosen format. */
export async function buildExport(db: Db, kind: ExportKind, deps: ExportDeps, now = Date.now(), onlyIds?: readonly string[]): Promise<ExportResult> {
  const categories = await listCategories(db);
  const names = new Map(categories.map((c) => [c.id, c.name]));
  let cards = await listCards(db, 'all');
  if (onlyIds) cards = cards.filter((c) => onlyIds.includes(c.id));
  let photoFailures = 0;
  const fail = () => photoFailures++;
  const fileName = exportFileName(kind, now);

  if (kind === 'csv') {
    const bytes = utf8.encode(writeGenericCsv(cards.map((c) => toData(c, names))));
    return { fileName, mimeType: 'text/csv', bytes, exported: cards.length, omitted: [], dropped: [], photoFailures, photos: 0 };
  }
  if (kind === 'backup') {
    const list: (BackupCard & { images?: CardImages })[] = [];
    for (const c of cards) {
      list.push({ ...toData(c, names), id: c.id, tile: c.tile, chainId: c.chainId, useCount: c.useCount, sortIndex: c.sortIndex, createdAt: c.createdAt, updatedAt: c.updatedAt, images: await images(c, deps.readPhoto, fail) });
    }
    const used = new Set(list.flatMap((c) => c.categories));
    const bytes = writeBackupZip(list, categories.map((c) => c.name).filter((n) => !onlyIds || used.has(n)), now);
    const photos = list.reduce((n, c) => n + (c.images?.front ? 1 : 0) + (c.images?.back ? 1 : 0), 0);
    return { fileName, mimeType: 'application/zip', bytes, exported: list.length, omitted: [], dropped: [], photoFailures, photos };
  }
  const list = [];
  for (const c of cards) list.push({ ...toData(c, names), images: await images(c, deps.photoAsPng, fail) });
  const out = writeCatimaZip(list, categories.map((c) => c.name));
  const photos = Object.keys(readZip(out.zip)).filter((n) => n.endsWith('.png')).length;
  return { fileName, mimeType: 'application/zip', bytes: out.zip, exported: out.exported, omitted: out.omitted, dropped: out.dropped, photoFailures, photos };
}

/** "12.4 KB" style size for the line shown before sharing. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

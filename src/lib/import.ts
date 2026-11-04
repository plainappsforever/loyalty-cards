// Stores what the Receive screen previewed (U5/U6). Never overwrites (L26): planImport splits new cards from duplicates
// (same number + format among live cards) by the rule the user picked once; categories are matched by name; every 2D
// card gets its render-once cache (D42) in the same transaction as its row; photos go files-first through storeNewCard
// (Catima PNG → our EXIF-free JPEG through `toJpeg`, D37.6). The summary counts are exact (SPEC §2, A13).
import { codeOf, createCards, listCards, type NewCard } from '@/db/cards';
import { getOrCreateCategory } from '@/db/categories';
import type { Db } from '@/db/types';
import { categoryKey } from '@/engine/card-data';
import { planImport, type DuplicateRule } from '@/engine/import-plan';
import { newId } from '@/lib/id';

import { buildCodeCache } from './code-cache';
import { storeNewCard, type CapturedPhotos, type FileOps } from './files';
import type { Received } from './receive';

export type ImportDeps = {
  fs: FileOps;
  /** Writes the image bytes to a temp file and returns its documents-relative path as an EXIF-free JPEG (≤ 1600 px). */
  toJpeg(bytes: Uint8Array, source: 'png' | 'jpeg'): Promise<string>;
};

export type ImportSummary = {
  imported: number;
  /** Rows the reader skipped (no name, no number, bad row) plus rows the database refused. */
  skipped: number;
  duplicates: number;
  /** Duplicates kept as extra cards (rule keepBoth). */
  keptDuplicates: number;
  invalidCodes: number;
  truncatedNames: number;
  brokenPhotos: number;
  /** Photos that could not be converted or stored: the card was imported without it. */
  photoFailures: number;
  ids: string[];
};

/** How many of the received cards already exist (shown before the user picks the duplicate rule). */
export async function countDuplicates(db: Db, received: Received): Promise<number> {
  const existing = (await listCards(db, 'all')).map((c) => ({ number: c.number, format: c.format }));
  return planImport(received.cards, existing, received.skipped, 'skip').duplicates.length;
}

export async function importReceived(db: Db, deps: ImportDeps, received: Received, rule: DuplicateRule, now = Date.now()): Promise<ImportSummary> {
  const existing = (await listCards(db, 'all')).map((c) => ({ number: c.number, format: c.format }));
  const plan = planImport(received.cards, existing, received.skipped, rule);

  const categoryIds = new Map<string, string>();
  for (const name of [...received.categories, ...plan.toCreate.flatMap((c) => c.categories)]) {
    const key = categoryKey(name);
    if (key === '' || categoryIds.has(key)) continue;
    try {
      categoryIds.set(key, await getOrCreateCategory(db, name, now));
    } catch {
      // a name the data layer refuses (empty after trimming) is simply not linked
    }
  }

  const ids: string[] = [];
  let rejected = 0;
  let photoFailures = 0;
  const plain: NewCard[] = [];
  for (const c of plan.toCreate) {
    const card: NewCard & { id: string } = {
      id: newId(now),
      name: c.name,
      number: c.number,
      codeValue: c.codeValue,
      format: c.format,
      color: c.color,
      tile: c.extras?.tile ?? 'initials',
      chainId: c.extras?.chainId ?? null,
      note: c.note,
      balance: c.balance,
      balanceCurrency: c.balanceCurrency,
      validFrom: c.validFrom,
      expiry: c.expiry,
      favourite: c.favourite,
      archived: c.archived,
      useCount: c.extras?.useCount ?? 0,
      lastUsedAt: c.lastUsedAt,
      categoryIds: c.categories.map((n) => categoryIds.get(categoryKey(n))).filter((x): x is string => !!x),
      codeCache: buildCodeCache(codeOf(c), c.format),
    };
    if (!c.images.front && !c.images.back) {
      plain.push(card);
      continue;
    }
    const photos: CapturedPhotos = {};
    for (const side of ['front', 'back'] as const) {
      const bytes = c.images[side];
      if (!bytes) continue;
      try {
        photos[side] = await deps.toJpeg(bytes, received.images);
      } catch {
        photoFailures++;
      }
    }
    try {
      ids.push(await storeNewCard(deps.fs, db, card, photos, now));
    } catch {
      rejected++;
    }
  }
  const bulk = await createCards(db, plain, now);
  ids.push(...bulk.ids);
  rejected += bulk.rejected.length;

  return {
    imported: ids.length,
    skipped: plan.summary.skipped + rejected,
    duplicates: plan.summary.duplicates,
    keptDuplicates: rule === 'keepBoth' ? plan.duplicates.length : 0,
    invalidCodes: received.invalidCodes,
    truncatedNames: received.truncatedNames,
    brokenPhotos: received.brokenPhotos,
    photoFailures,
    ids,
  };
}
